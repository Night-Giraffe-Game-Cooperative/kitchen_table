defmodule Family.FakeCalDAV do
  @moduledoc """
  A small CalDAV server for tests, on this machine: one account (alex,
  "app-password") with a family calendar, a read-only holidays calendar and
  a reminders list, plus a school's calendar feed anyone can fetch. It
  answers as iCloud does, near enough.
  """

  import Plug.Conn

  @user "alex"
  @password "app-password"

  def start do
    {:ok, _} = Agent.start_link(fn -> %{objects: %{}, ctag: 1, log: []} end, name: __MODULE__)
    {:ok, server} = Bandit.start_link(plug: __MODULE__, ip: :loopback, port: 0, startup_log: false)
    {:ok, {_ip, port}} = ThousandIsland.listener_info(server)
    Agent.update(__MODULE__, &Map.put(&1, :port, port))
    {:ok, "http://127.0.0.1:#{port}"}
  end

  def put_object(path, data) do
    Agent.update(__MODULE__, fn s ->
      %{s | objects: Map.put(s.objects, path, {data, etag()}), ctag: s.ctag + 1}
    end)
  end

  def object(path), do: Agent.get(__MODULE__, fn s -> s.objects[path] end)
  def objects, do: Agent.get(__MODULE__, & &1.objects)
  def log, do: Agent.get(__MODULE__, &Enum.reverse(&1.log))

  defp etag, do: ~s("#{System.unique_integer([:positive])}")

  def init(opts), do: opts

  def call(conn, _) do
    {:ok, body, conn} = read_body(conn)
    Agent.update(__MODULE__, &%{&1 | log: [{conn.method, conn.request_path} | &1.log]})

    cond do
      conn.request_path == "/feeds/school.ics" -> send_resp(conn, 200, school())
      # Saved by an old Windows program: Latin-1, not UTF-8.
      conn.request_path == "/feeds/latin1.ics" -> send_resp(conn, 200, :unicode.characters_to_binary(latin1(), :utf8, :latin1))
      conn.request_path == "/.well-known/caldav" -> conn |> put_resp_header("location", "/") |> send_resp(301, "")
      not signed_in?(conn) -> send_resp(conn, 401, "")
      true -> handle(conn.method, conn.request_path, conn, body)
    end
  end

  defp latin1 do
    """
    BEGIN:VCALENDAR\r
    VERSION:2.0\r
    BEGIN:VEVENT\r
    UID:fete-1\r
    DTSTART;VALUE=DATE:20261024\r
    SUMMARY:Summer fête and café\r
    END:VEVENT\r
    END:VCALENDAR\r
    """
  end

  defp signed_in?(conn) do
    get_req_header(conn, "authorization") == ["Basic " <> Base.encode64(@user <> ":" <> @password)]
  end

  @home "/calendars/alex/"

  defp handle("PROPFIND", "/", conn, _), do: multistatus(conn, [response("/", ~s(<d:current-user-principal><d:href>/principals/alex/</d:href></d:current-user-principal>))])

  defp handle("PROPFIND", "/principals/alex/", conn, _),
    do: multistatus(conn, [response("/principals/alex/", ~s(<c:calendar-home-set><d:href>#{@home}</d:href></c:calendar-home-set>))])

  defp handle("PROPFIND", @home, conn, _) do
    ctag = Agent.get(__MODULE__, & &1.ctag)

    multistatus(conn, [
      response(@home, "<d:resourcetype><d:collection/></d:resourcetype>"),
      response(@home <> "family/", calendar("Family", "#FF2968FF", "VEVENT", "<d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege>", ctag)),
      response(@home <> "holidays/", calendar("UK Holidays", "#34AADCFF", "VEVENT", "<d:privilege><d:read/></d:privilege>", 1)),
      response(@home <> "reminders/", calendar("Reminders", "#AAAAAAFF", "VTODO", "<d:privilege><d:write/></d:privilege>", 1))
    ])
  end

  defp handle("PROPFIND", @home <> "family/", conn, _),
    do: multistatus(conn, [response(@home <> "family/", "<cs:getctag>#{Agent.get(__MODULE__, & &1.ctag)}</cs:getctag>")])

  defp handle("PROPFIND", @home <> "holidays/", conn, _), do: multistatus(conn, [response(@home <> "holidays/", "<cs:getctag>1</cs:getctag>")])

  defp handle("REPORT", @home <> cal, conn, _) do
    objects = Agent.get(__MODULE__, & &1.objects)

    responses =
      for {path, {data, etag}} <- objects, String.starts_with?(path, @home <> cal) do
        response(path, "<d:getetag>#{escape(etag)}</d:getetag><c:calendar-data>#{escape(data)}</c:calendar-data>")
      end

    multistatus(conn, responses)
  end

  defp handle("GET", path, conn, _) do
    case object(path) do
      {data, etag} -> conn |> put_resp_header("etag", etag) |> put_resp_content_type("text/calendar") |> send_resp(200, data)
      nil -> send_resp(conn, 404, "")
    end
  end

  defp handle("PUT", @home <> "holidays/" <> _, conn, _), do: send_resp(conn, 403, "")

  defp handle("PUT", path, conn, body) do
    current = object(path)

    cond do
      get_req_header(conn, "if-none-match") == ["*"] and current != nil -> send_resp(conn, 412, "")
      (match = get_req_header(conn, "if-match")) != [] and (current == nil or [elem(current, 1)] != match) -> send_resp(conn, 412, "")
      true ->
        put_object(path, body)
        conn |> put_resp_header("etag", elem(object(path), 1)) |> send_resp(if(current, do: 204, else: 201), "")
    end
  end

  defp handle("DELETE", path, conn, _) do
    Agent.update(__MODULE__, fn s -> %{s | objects: Map.delete(s.objects, path), ctag: s.ctag + 1} end)
    send_resp(conn, 204, "")
  end

  defp handle(_, _, conn, _), do: send_resp(conn, 404, "")

  defp calendar(name, color, comp, privileges, ctag) do
    "<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>#{name}</d:displayname>" <>
      "<a:calendar-color>#{color}</a:calendar-color>" <>
      ~s(<c:supported-calendar-component-set><c:comp name="#{comp}"/></c:supported-calendar-component-set>) <>
      "<d:current-user-privilege-set>#{privileges}</d:current-user-privilege-set><cs:getctag>#{ctag}</cs:getctag>"
  end

  defp response(href, props) do
    "<d:response><d:href>#{href}</d:href><d:propstat><d:prop>#{props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"
  end

  defp multistatus(conn, responses) do
    body =
      ~s(<?xml version="1.0" encoding="UTF-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" ) <>
        ~s(xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">#{Enum.join(responses)}</d:multistatus>)

    conn |> put_resp_content_type("application/xml") |> send_resp(207, body)
  end

  defp escape(text), do: text |> String.replace("&", "&amp;") |> String.replace("<", "&lt;") |> String.replace(">", "&gt;")

  defp school do
    today = Date.utc_today()
    inset = Date.add(today, 10) |> Date.to_iso8601(:basic)
    trip = Date.add(today, 20) |> Date.to_iso8601(:basic)

    """
    BEGIN:VCALENDAR\r
    VERSION:2.0\r
    X-WR-CALNAME:Oak Primary\r
    BEGIN:VEVENT\r
    UID:inset-1\r
    DTSTART;VALUE=DATE:#{inset}\r
    SUMMARY:INSET day\r
    END:VEVENT\r
    BEGIN:VEVENT\r
    UID:trip-1\r
    DTSTART;TZID=Europe/London:#{trip}T090000\r
    DTEND;TZID=Europe/London:#{trip}T150000\r
    SUMMARY:Year 2 trip to the zoo\r
    END:VEVENT\r
    END:VCALENDAR\r
    """
  end
end
