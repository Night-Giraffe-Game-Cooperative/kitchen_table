defmodule Family.Calendar.DAV do
  @moduledoc """
  Talks CalDAV (RFC 4791), the way iCloud, Fastmail, Nextcloud and most
  other calendar services share calendars with other apps, and fetches
  calendar feeds (an .ics address, which Google, Outlook and many schools
  and clubs give out).

  Requests go over Mint, which can send WebDAV's own methods (PROPFIND and
  REPORT). Replies are read with OTP's streaming XML reader, which never
  makes atoms from what a server sends.
  """

  require Logger
  alias Family.HTTP

  @dav "DAV:"
  @caldav "urn:ietf:params:xml:ns:caldav"
  @cs "http://calendarserver.org/ns/"
  @apple "http://apple.com/ns/ical/"
  @max_body 20_000_000
  @timeout 30_000

  @type auth :: {String.t(), String.t()} | nil

  ## Finding calendars

  @doc """
  The calendars an account can see, from a server's address (or a single
  calendar's): `%{url, name, color, writable, ctag}` for each that holds
  events.
  """
  def discover(url, auth) do
    with {:ok, start} <- address(url),
         {:ok, home_or_calendars} <- find_home(start, auth) do
      case home_or_calendars do
        {:calendars, calendars} -> {:ok, calendars}
        {:home, home} -> calendars_in(home, auth)
      end
    end
  end

  defp find_home(url, auth, tried_well_known \\ false) do
    body = propfind([{@dav, "current-user-principal"}, {@caldav, "calendar-home-set"}, {@dav, "resourcetype"}] ++ calendar_props())

    case request("PROPFIND", url, auth, [{"depth", "0"}], body) do
      {:ok, %{status: 207} = resp} ->
        with {:ok, [first | _]} <- multistatus(resp) do
          cond do
            calendar?(first.props) ->
              {:ok, {:calendars, [calendar(first)]}}

            home = href_in(first.props[{@caldav, "calendar-home-set"}], resp.url) ->
              {:ok, {:home, home}}

            principal = href_in(first.props[{@dav, "current-user-principal"}], resp.url) ->
              principal_home(principal, auth)

            not tried_well_known ->
              find_home(well_known(url), auth, true)

            true ->
              {:error, "That address doesn't lead to any calendars."}
          end
        else
          _ -> if tried_well_known, do: {:error, "That address doesn't lead to any calendars."}, else: find_home(well_known(url), auth, true)
        end

      {:ok, %{status: s}} when s in [401, 403] ->
        {:error, :unauthorized}

      {:ok, %{status: _}} when not tried_well_known ->
        find_home(well_known(url), auth, true)

      {:ok, %{status: s}} ->
        Logger.info("Calendar discovery at #{host(url)}: HTTP #{s}")
        {:error, "The server at #{host(url)} didn't answer as a calendar server would."}

      {:error, _} = error ->
        error
    end
  end

  defp principal_home(principal, auth) do
    case request("PROPFIND", principal, auth, [{"depth", "0"}], propfind([{@caldav, "calendar-home-set"}])) do
      {:ok, %{status: 207} = resp} ->
        with {:ok, [first | _]} <- multistatus(resp),
             home when is_binary(home) <- href_in(first.props[{@caldav, "calendar-home-set"}], resp.url) do
          {:ok, {:home, home}}
        else
          _ -> {:error, "That account doesn't have any calendars."}
        end

      {:ok, %{status: s}} when s in [401, 403] ->
        {:error, :unauthorized}

      {:ok, %{status: s}} ->
        Logger.info("Calendar list at #{host(principal)}: HTTP #{s}")
        {:error, "The server at #{host(principal)} wouldn't list the calendars."}

      error ->
        error
    end
  end

  defp calendars_in(home, auth) do
    case request("PROPFIND", home, auth, [{"depth", "1"}], propfind(calendar_props())) do
      {:ok, %{status: 207} = resp} ->
        with {:ok, entries} <- multistatus(resp) do
          calendars =
            entries
            |> Enum.filter(&calendar?(&1.props))
            |> Enum.filter(&events?(&1.props))
            |> Enum.map(&calendar/1)
            |> Enum.uniq_by(& &1.url)

          if calendars == [], do: {:error, "That account doesn't have any calendars for events."}, else: {:ok, calendars}
        end

      {:ok, %{status: s}} when s in [401, 403] ->
        {:error, :unauthorized}

      {:ok, %{status: s}} ->
        Logger.info("Calendar list at #{host(home)}: HTTP #{s}")
        {:error, "The server at #{host(home)} wouldn't list the calendars."}

      error ->
        error
    end
  end

  defp calendar_props do
    [
      {@dav, "resourcetype"},
      {@dav, "displayname"},
      {@dav, "current-user-privilege-set"},
      {@caldav, "supported-calendar-component-set"},
      {@cs, "getctag"},
      {@dav, "sync-token"},
      {@apple, "calendar-color"}
    ]
  end

  defp calendar?(props) do
    case props[{@dav, "resourcetype"}] do
      nil -> false
      node -> Enum.any?(elements(node), &(name(&1) == {@caldav, "calendar"}))
    end
  end

  # Calendars that only hold reminders or to-dos are left out.
  defp events?(props) do
    case props[{@caldav, "supported-calendar-component-set"}] do
      nil ->
        true

      node ->
        comps = for c <- elements(node), name(c) == {@caldav, "comp"}, do: String.upcase(attr(c, "name") || "")
        comps == [] or "VEVENT" in comps
    end
  end

  defp calendar(%{href: url, props: props}) do
    privileges =
      case props[{@dav, "current-user-privilege-set"}] do
        nil -> nil
        node -> for p <- elements(node), name(p) == {@dav, "privilege"}, q <- elements(p), do: elem(name(q), 1)
      end

    %{
      url: url,
      name: text(props[{@dav, "displayname"}]) |> present() || url |> URI.parse() |> Map.get(:path, "") |> Path.basename(),
      color: color(text(props[{@apple, "calendar-color"}])),
      # Without a list of what the account may do, assume it can write; the
      # server says no when it can't.
      writable: is_nil(privileges) or Enum.any?(privileges, &(&1 in ["write", "write-content", "all"])),
      ctag: present(text(props[{@cs, "getctag"}])) || present(text(props[{@dav, "sync-token"}]))
    }
  end

  defp color(nil), do: nil

  defp color(text) do
    case Regex.run(~r/^#([0-9a-fA-F]{6})/, String.trim(text)) do
      [_, hex] -> "#" <> String.downcase(hex)
      _ -> nil
    end
  end

  defp well_known(url) do
    uri = URI.parse(url)
    URI.to_string(%URI{uri | path: "/.well-known/caldav", query: nil, fragment: nil})
  end

  ## Reading and changing events

  @doc "What a calendar has as its ctag (or sync token): it changes whenever anything in it does."
  def ctag(url, auth) do
    case request("PROPFIND", url, auth, [{"depth", "0"}], propfind([{@cs, "getctag"}, {@dav, "sync-token"}])) do
      {:ok, %{status: 207} = resp} ->
        case multistatus(resp) do
          {:ok, [first | _]} -> {:ok, present(text(first.props[{@cs, "getctag"}])) || present(text(first.props[{@dav, "sync-token"}]))}
          _ -> {:ok, nil}
        end

      other ->
        status_error(other, url)
    end
  end

  @doc "Every calendar object with an event between two moments: `%{href, etag, data}`."
  def events(url, auth, %DateTime{} = from, %DateTime{} = to) do
    body = """
    <?xml version="1.0" encoding="utf-8"?>
    <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:prop><d:getetag/><c:calendar-data/></d:prop>
      <c:filter>
        <c:comp-filter name="VCALENDAR">
          <c:comp-filter name="VEVENT">
            <c:time-range start="#{stamp(from)}" end="#{stamp(to)}"/>
          </c:comp-filter>
        </c:comp-filter>
      </c:filter>
    </c:calendar-query>
    """

    case request("REPORT", url, auth, [{"depth", "1"}], body) do
      {:ok, %{status: 207} = resp} ->
        with {:ok, entries} <- multistatus(resp) do
          objects =
            for %{href: href, props: props} <- entries,
                data = text(props[{@caldav, "calendar-data"}]),
                data not in [nil, ""],
                do: %{href: href, etag: present(text(props[{@dav, "getetag"}])), data: data}

          {:ok, objects}
        end

      other ->
        status_error(other, url)
    end
  end

  @doc "One calendar object: `%{data, etag}`."
  def get(href, auth) do
    case request("GET", href, auth, [{"accept", "text/calendar"}], nil) do
      {:ok, %{status: 200} = resp} -> {:ok, %{data: utf8(resp.body), etag: header(resp, "etag")}}
      {:ok, %{status: s}} when s in [404, 410] -> {:error, :gone}
      other -> status_error(other, href)
    end
  end

  @doc """
  Saves a calendar object. With an etag it only replaces the one the app
  last saw; without, it only makes a new one. Returns the new etag if the
  server says it.
  """
  def put(href, auth, data, etag) do
    condition = if etag, do: {"if-match", etag}, else: {"if-none-match", "*"}

    case request("PUT", href, auth, [{"content-type", "text/calendar; charset=utf-8"}, condition], data) do
      {:ok, %{status: s} = resp} when s in 200..299 -> {:ok, header(resp, "etag")}
      {:ok, %{status: 412}} -> {:error, :changed}
      {:ok, %{status: s}} when s in [403, 405] -> {:error, :read_only}
      other -> status_error(other, href)
    end
  end

  @doc "Deletes a calendar object, if it's still the one the app last saw."
  def delete(href, auth, etag) do
    headers = if etag, do: [{"if-match", etag}], else: []

    case request("DELETE", href, auth, headers, nil) do
      {:ok, %{status: s}} when s in 200..299 or s in [404, 410] -> :ok
      {:ok, %{status: 412}} -> {:error, :changed}
      {:ok, %{status: s}} when s in [403, 405] -> {:error, :read_only}
      other -> status_error(other, href)
    end
  end

  @doc "A calendar feed's text, and its ETag."
  def fetch(url) do
    with {:ok, url} <- address(url) do
      case request("GET", url, nil, [{"accept", "text/calendar, */*"}], nil) do
        {:ok, %{status: 200, body: body} = resp} ->
          if String.contains?(body, "BEGIN:VCALENDAR"),
            do: {:ok, %{data: utf8(body), etag: header(resp, "etag")}},
            else: {:error, "That address isn't a calendar. It needs to be the calendar's iCal (.ics) address."}

        {:ok, %{status: s}} when s in [401, 403, 404, 410] ->
          Logger.info("Calendar feed at #{host(url)}: HTTP #{s}")
          {:error, "#{host(url)} wouldn't share that calendar. Check the address is the calendar's secret or public iCal address."}

        other ->
          status_error(other, url)
      end
    end
  end

  defp status_error({:ok, %{status: s}}, _) when s in [401, 403], do: {:error, :unauthorized}
  defp status_error({:ok, %{status: s}}, url) do
    Logger.info("Calendar server #{host(url)}: HTTP #{s}")
    {:error, "The server at #{host(url)} said no."}
  end
  defp status_error({:error, _} = error, _), do: error

  @doc "A calendar address as typed: webcal:// becomes https://, and a bare host gets https://."
  def address(url) when is_binary(url) do
    url = String.trim(url)

    url =
      cond do
        url == "" -> ""
        String.match?(url, ~r{^webcals?://}i) -> String.replace(url, ~r{^webcals?://}i, "https://")
        String.match?(url, ~r{^https?://}i) -> url
        true -> "https://" <> url
      end

    case URI.parse(url) do
      %URI{scheme: scheme, host: host} when scheme in ["http", "https"] and is_binary(host) and host != "" ->
        {:ok, if(URI.parse(url).path in [nil, ""], do: url <> "/", else: url)}

      _ ->
        {:error, "That doesn't look like a web address."}
    end
  end

  def address(_), do: {:error, "That doesn't look like a web address."}

  def host(url), do: URI.parse(url).host || url

  ## XML

  defp propfind(props) do
    prefixes = %{@dav => "d", @caldav => "c", @cs => "cs", @apple => "a"}
    inner = Enum.map_join(props, "", fn {ns, name} -> "<#{prefixes[ns]}:#{name}/>" end)

    ~s(<?xml version="1.0" encoding="utf-8"?>) <>
      ~s(<d:propfind xmlns:d="DAV:" xmlns:c="#{@caldav}" xmlns:cs="#{@cs}" xmlns:a="#{@apple}"><d:prop>#{inner}</d:prop></d:propfind>)
  end

  # Each <response> in a 207: its href (made absolute) and the properties
  # the server found, by {namespace, name}.
  defp multistatus(%{body: body, url: base}) do
    with {:ok, root} <- xml(body) do
      entries =
        for response <- elements(root),
            name(response) == {@dav, "response"},
            href = href_of(response, base),
            do: %{href: href, props: props_of(response)}

      {:ok, entries}
    end
  end

  defp props_of(response) do
    for propstat <- elements(response),
        name(propstat) == {@dav, "propstat"},
        ok?(propstat),
        prop <- elements(propstat),
        name(prop) == {@dav, "prop"},
        value <- elements(prop),
        into: %{},
        do: {name(value), value}
  end

  defp href_of(response, base) do
    case Enum.find(elements(response), &(name(&1) == {@dav, "href"})) do
      nil -> nil
      node -> base |> URI.merge(String.trim(text(node))) |> URI.to_string()
    end
  end

  defp ok?(propstat) do
    case Enum.find(elements(propstat), &(name(&1) == {@dav, "status"})) do
      nil -> true
      status -> String.contains?(text(status), " 200")
    end
  end

  # <current-user-principal><href>/123/principal/</href></current-user-principal>
  defp href_in(nil, _), do: nil

  defp href_in(node, base) do
    case Enum.find(elements(node), &(name(&1) == {@dav, "href"})) do
      nil -> nil
      href -> base |> URI.merge(String.trim(text(href))) |> URI.to_string()
    end
  end

  @doc false
  # An element is {{namespace, name}, attributes, children}; text is a binary.
  def xml(body) do
    if Regex.match?(~r/<!(DOCTYPE|ENTITY)/i, body) do
      {:error, "The server's reply couldn't be read."}
    else
      case :xmerl_sax_parser.stream(body, event_fun: &sax/3, event_state: [], external_entities: :none) do
        {:ok, {:done, root}, _} -> {:ok, root}
        _ -> {:error, "The server's reply couldn't be read."}
      end
    end
  rescue
    _ -> {:error, "The server's reply couldn't be read."}
  end

  defp sax({:startElement, uri, local, _qname, attrs}, _, stack) do
    attrs = Map.new(attrs, fn {_uri, _prefix, name, value} -> {List.to_string(name), List.to_string(value)} end)
    [{{List.to_string(uri), List.to_string(local)}, attrs, []} | stack]
  end

  defp sax({:characters, chars}, _, [{name, attrs, children} | rest]),
    do: [{name, attrs, [List.to_string(chars) | children]} | rest]

  defp sax({:endElement, _, _, _}, _, [{name, attrs, children} | rest]) do
    node = {name, attrs, Enum.reverse(children)}

    case rest do
      [] -> {:done, node}
      [{pname, pattrs, pchildren} | up] -> [{pname, pattrs, [node | pchildren]} | up]
    end
  end

  defp sax(_, _, state), do: state

  defp name({name, _, _}), do: name
  defp attr({_, attrs, _}, key), do: attrs[key]
  defp elements({_, _, children}), do: Enum.filter(children, &is_tuple/1)

  defp text(nil), do: nil
  defp text(binary) when is_binary(binary), do: binary
  defp text({_, _, children}), do: Enum.map_join(children, "", &text/1)

  defp present(nil), do: nil
  defp present(s), do: if(String.trim(s) == "", do: nil, else: String.trim(s))

  defp stamp(t), do: t |> DateTime.shift_zone!("Etc/UTC") |> Calendar.strftime("%Y%m%dT%H%M%SZ")

  ## HTTP

  defp header(resp, name), do: HTTP.header(resp, name)

  @doc false
  def request(method, url, auth, headers, body, redirects \\ 5) do
    uri = URI.parse(url)

    headers =
      [{"user-agent", "KitchenTable/1.0 (family calendar)"} | headers] ++
        if(body && method in ["PROPFIND", "REPORT"], do: [{"content-type", "application/xml; charset=utf-8"}], else: []) ++
        case auth do
          {user, password} -> [{"authorization", "Basic " <> Base.encode64(user <> ":" <> password)}]
          nil -> []
        end

    with {:ok, resp} <- send_request(method, uri, headers, body) do
      location = header(resp, "location")

      cond do
        resp.status in [301, 302, 303, 307, 308] and is_binary(location) and redirects > 0 ->
          next = uri |> URI.merge(location) |> URI.to_string()
          # A password only follows a redirect that stays secure and with the
          # same provider (iCloud sends people on to pNN-caldav.icloud.com).
          auth = if same_site?(uri, URI.parse(next)), do: auth, else: nil
          {method, body} = if resp.status == 303, do: {"GET", nil}, else: {method, body}
          request(method, next, auth, Enum.reject(headers, &(elem(&1, 0) in ["authorization", "user-agent", "content-type"])), body, redirects - 1)

        true ->
          {:ok, Map.put(resp, :url, url)}
      end
    end
  end

  # The server only reaches out to the internet, not to the network it sits
  # on, unless whoever runs it says otherwise (a Nextcloud at home, say).
  defp send_request(_method, %URI{scheme: scheme}, _headers, _body) when scheme not in ["http", "https"],
    do: {:error, "That isn't a web address."}

  defp send_request(method, %URI{} = uri, headers, body) do
    private = Application.get_env(:family, :calendar_private_hosts, false)

    case HTTP.request(method, uri, headers, body, max_body: @max_body, timeout: @timeout, allow_private: private) do
      {:ok, resp} -> {:ok, resp}
      {:error, reason} -> unreachable(uri, reason)
    end
  end

  # Calendars are meant to be UTF-8, but some (a school's, saved by an old
  # Windows program) come as Latin-1, which can't go on to a browser as it is.
  defp utf8(text) do
    if String.valid?(text), do: text, else: :unicode.characters_to_binary(text, :latin1, :utf8)
  end

  defp same_site?(%URI{} = from, %URI{} = to) do
    to.scheme in ["https", from.scheme] and is_binary(to.host) and (to.host == from.host or site(to.host) == site(from.host))
  end

  # The part of a host name its owner registered: icloud.com, or example.co.uk.
  defp site(host) do
    labels = String.split(host, ".")

    case Enum.take(labels, -3) do
      [_, second, top] = last when byte_size(top) == 2 and second in ~w(co com org net ac gov) -> Enum.join(last, ".")
      _ -> labels |> Enum.take(-2) |> Enum.join(".")
    end
  end

  defp unreachable(uri, :too_big), do: {:error, "The calendar at #{uri.host} is too big to bring in."}
  defp unreachable(uri, :private), do: {:error, "#{uri.host} is on a private network, so the app can't reach it."}
  defp unreachable(_uri, :no_host), do: {:error, "That isn't a web address."}

  defp unreachable(uri, reason) do
    Logger.warning("Calendar server #{uri.host} unreachable: #{inspect(reason) |> String.slice(0, 200)}")
    {:error, "Couldn't reach #{uri.host}. Check the address, or try again in a minute."}
  end

end
