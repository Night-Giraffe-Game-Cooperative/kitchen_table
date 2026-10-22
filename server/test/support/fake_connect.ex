defmodule Family.FakeConnect do
  @moduledoc """
  Google and Microsoft, near enough, for tests: their sign-in (token
  endpoints that check the PKCE code and the app's client ID and secret)
  and their calendar APIs, on this machine. Each has one person signed in,
  with a calendar of their own and one they can only look at.
  """

  import Plug.Conn

  @google_client {"123-family.apps.googleusercontent.com", "google-secret"}
  @microsoft_client {"0a1b2c3d-1111-2222-3333-444455556666", "microsoft-secret"}

  def google_client, do: @google_client
  def microsoft_client, do: @microsoft_client

  def start do
    {:ok, _} = Agent.start_link(fn -> initial() end, name: __MODULE__)
    {:ok, server} = Bandit.start_link(plug: __MODULE__, ip: :loopback, port: 0, startup_log: false)
    {:ok, {_ip, port}} = ThousandIsland.listener_info(server)
    base = "http://127.0.0.1:#{port}"

    Application.put_env(:family, :connect_urls, %{
      google_accounts: base <> "/google-accounts",
      google_oauth: base <> "/google-oauth",
      google_api: base <> "/google-api",
      microsoft_login: base <> "/microsoft-login",
      microsoft_graph: base <> "/microsoft-graph"
    })

    {:ok, base}
  end

  defp initial do
    %{
      # code => {provider, challenge, redirect_uri}
      codes: %{},
      refresh: %{"google" => nil, "microsoft" => nil},
      access: %{"google" => nil, "microsoft" => nil},
      revoked: [],
      log: [],
      updated: "2026-10-22T10:00:00.000Z",
      google: %{},
      graph: %{}
    }
  end

  @doc "Someone says yes on the provider's page: gives the code it sends back."
  def consent(provider, authorize_url) do
    query = authorize_url |> URI.parse() |> Map.get(:query) |> URI.decode_query()
    code = "code-#{System.unique_integer([:positive])}"
    Agent.update(__MODULE__, &put_in(&1, [:codes, code], {provider, query["code_challenge"], query["redirect_uri"]}))
    %{"code" => code, "state" => query["state"]}
  end

  @doc "The provider forgets the app (someone removed its access)."
  def revoke(provider), do: Agent.update(__MODULE__, &put_in(&1, [:refresh, provider], nil))

  @doc "Access tokens stop working, as if they ran out early."
  def expire(provider), do: Agent.update(__MODULE__, &put_in(&1, [:access, provider], "gone"))

  def put_google(id, item), do: Agent.update(__MODULE__, &(&1 |> put_in([:google, id], Map.merge(%{"id" => id, "etag" => etag()}, item)) |> touch()))
  def put_graph(id, item), do: Agent.update(__MODULE__, &put_in(&1, [:graph, id], Map.merge(%{"id" => id, "@odata.etag" => etag()}, item)))
  def google(id), do: Agent.get(__MODULE__, & &1.google[id])
  def graph(id), do: Agent.get(__MODULE__, & &1.graph[id])
  def google_items, do: Agent.get(__MODULE__, & &1.google)
  def graph_items, do: Agent.get(__MODULE__, & &1.graph)
  def log, do: Agent.get(__MODULE__, &Enum.reverse(&1.log))
  def revoked, do: Agent.get(__MODULE__, & &1.revoked)

  defp touch(s), do: %{s | updated: DateTime.utc_now() |> DateTime.to_iso8601()}
  defp etag, do: ~s("#{System.unique_integer([:positive])}")

  def init(opts), do: opts

  def call(conn, _) do
    {:ok, body, conn} = read_body(conn)
    conn = fetch_query_params(conn)
    Agent.update(__MODULE__, &%{&1 | log: [{conn.method, conn.request_path} | &1.log]})

    case Enum.map(conn.path_info, &URI.decode/1) do
      ["google-oauth", "token"] -> token(conn, "google", URI.decode_query(body))
      ["google-oauth", "revoke"] -> revoke_token(conn, URI.decode_query(body))
      ["microsoft-login", "common", "oauth2", "v2.0", "token"] -> token(conn, "microsoft", URI.decode_query(body))
      ["google-api" | rest] -> if signed_in?(conn, "google"), do: google(conn, conn.method, rest, body), else: send_resp(conn, 401, "")
      ["microsoft-graph" | rest] -> if signed_in?(conn, "microsoft"), do: graph(conn, conn.method, rest, body), else: send_resp(conn, 401, "")
      _ -> send_resp(conn, 404, "")
    end
  end

  ## Signing in

  defp token(conn, provider, form) do
    {id, secret} = if provider == "google", do: @google_client, else: @microsoft_client
    state = Agent.get(__MODULE__, & &1)

    cond do
      form["client_id"] != id or form["client_secret"] != secret ->
        json(conn, 401, %{error: "invalid_client"})

      form["grant_type"] == "authorization_code" ->
        case state.codes[form["code"]] do
          {^provider, challenge, redirect} ->
            verified = :crypto.hash(:sha256, form["code_verifier"] || "") |> Base.url_encode64(padding: false)

            if verified == challenge and redirect == form["redirect_uri"] do
              Agent.update(__MODULE__, &update_in(&1, [:codes], fn c -> Map.delete(c, form["code"]) end))
              json(conn, 200, issue(provider, true))
            else
              json(conn, 400, %{error: "invalid_grant"})
            end

          _ ->
            json(conn, 400, %{error: "invalid_grant"})
        end

      form["grant_type"] == "refresh_token" and form["refresh_token"] == state.refresh[provider] and is_binary(form["refresh_token"]) ->
        # Microsoft gives a new refresh token every time; Google doesn't.
        json(conn, 200, issue(provider, provider == "microsoft"))

      true ->
        json(conn, 400, %{error: "invalid_grant"})
    end
  end

  defp issue(provider, new_refresh) do
    access = "#{provider}-access-#{System.unique_integer([:positive])}"
    refresh = "#{provider}-refresh-#{System.unique_integer([:positive])}"

    Agent.update(__MODULE__, fn s ->
      s = put_in(s, [:access, provider], access)
      if new_refresh, do: put_in(s, [:refresh, provider], refresh), else: s
    end)

    email = if provider == "google", do: "alex.family@gmail.com", else: "alex.family@outlook.com"
    claims = Base.url_encode64(Jason.encode!(%{email: email, sub: "123"}), padding: false)

    %{access_token: access, expires_in: 3599, token_type: "Bearer", id_token: "e30.#{claims}.sig"}
    |> then(fn t -> if new_refresh, do: Map.put(t, :refresh_token, refresh), else: t end)
  end

  defp revoke_token(conn, form) do
    Agent.update(__MODULE__, &%{&1 | revoked: [form["token"] | &1.revoked], refresh: Map.put(&1.refresh, "google", nil)})
    send_resp(conn, 200, "")
  end

  defp signed_in?(conn, provider) do
    access = Agent.get(__MODULE__, & &1.access[provider])
    is_binary(access) and get_req_header(conn, "authorization") == ["Bearer " <> access]
  end

  ## Google Calendar

  @primary "alex.family@gmail.com"
  @holidays "en.uk#holiday@group.v.calendar.google.com"

  defp google(conn, "GET", ["users", "me", "calendarList"], _) do
    json(conn, 200, %{
      items: [
        %{id: @holidays, summary: "Holidays in the United Kingdom", backgroundColor: "#16a765", accessRole: "reader"},
        %{id: @primary, summary: @primary, summaryOverride: "Alex", backgroundColor: "#9FC6E7", accessRole: "owner", primary: true}
      ]
    })
  end

  defp google(conn, "GET", ["calendars", @primary, "events"], _) do
    s = Agent.get(__MODULE__, & &1)

    if conn.query_params["fields"] == "updated" do
      json(conn, 200, %{updated: s.updated})
    else
      # Two pages, as Google sends a long calendar.
      items = s.google |> Map.values() |> Enum.sort_by(& &1["id"])
      {first, rest} = Enum.split(items, 2)

      case conn.query_params["pageToken"] do
        "2" -> json(conn, 200, %{items: rest, updated: s.updated})
        _ -> json(conn, 200, if(rest == [], do: %{items: first}, else: %{items: first, nextPageToken: "2"}))
      end
    end
  end

  defp google(conn, "GET", ["calendars", @holidays, "events"], _) do
    json(conn, 200, %{updated: "2026-01-01T00:00:00.000Z", items: [%{id: "xmas", status: "confirmed", summary: "Christmas Day", start: %{date: "2026-12-25"}, end: %{date: "2026-12-26"}, etag: ~s("1")}]})
  end

  defp google(conn, "POST", ["calendars", @primary, "events"], body) do
    item = Jason.decode!(body)
    id = "new#{System.unique_integer([:positive])}"
    put_google(id, Map.merge(item, %{"iCalUID" => id <> "@google.com", "status" => "confirmed"}))
    json(conn, 200, google(id))
  end

  defp google(conn, "PATCH", ["calendars", @primary, "events", id], body) do
    case google(id) do
      nil ->
        json(conn, 404, %{})

      item ->
        if get_req_header(conn, "if-match") not in [[], [item["etag"]]] do
          json(conn, 412, %{error: %{code: 412, message: "Precondition Failed"}})
        else
          put_google(id, Map.merge(item, Jason.decode!(body)) |> Map.put("etag", etag()))
          json(conn, 200, google(id))
        end
    end
  end

  defp google(conn, "DELETE", ["calendars", @primary, "events", id], _) do
    Agent.update(__MODULE__, &(&1 |> update_in([:google], fn g -> Map.delete(g, id) end) |> touch()))
    send_resp(conn, 204, "")
  end

  defp google(conn, _, _, _), do: json(conn, 404, %{error: %{code: 404}})

  ## Microsoft Graph

  @calendar "AAMkAGI2-calendar="
  @birthdays "AAMkAGI2-birthdays="

  defp graph(conn, "GET", ["me", "calendars"], _) do
    json(conn, 200, %{
      value: [
        %{id: @birthdays, name: "Birthdays", hexColor: "", canEdit: false, isDefaultCalendar: false},
        %{id: @calendar, name: "Calendar", hexColor: "#E9A06B", canEdit: true, isDefaultCalendar: true}
      ]
    })
  end

  defp graph(conn, "GET", ["me", "calendars", @calendar, "calendarView"], _) do
    items = Agent.get(__MODULE__, & &1.graph) |> Map.values() |> Enum.sort_by(& &1["id"])
    json(conn, 200, %{value: items})
  end

  defp graph(conn, "GET", ["me", "calendars", @birthdays, "calendarView"], _), do: json(conn, 200, %{value: []})

  defp graph(conn, "POST", ["me", "calendars", @calendar, "events"], body) do
    id = "AAMk-new#{System.unique_integer([:positive])}"
    put_graph(id, Map.merge(Jason.decode!(body), %{"iCalUId" => "uid-" <> id, "type" => "singleInstance"}))
    json(conn, 201, graph(id))
  end

  defp graph(conn, "PATCH", ["me", "events", id], body) do
    case graph(id) do
      nil ->
        json(conn, 404, %{})

      item ->
        if get_req_header(conn, "if-match") not in [[], [item["@odata.etag"]]] do
          json(conn, 412, %{error: %{code: "ErrorIrresolvableConflict"}})
        else
          put_graph(id, Map.merge(item, Jason.decode!(body)) |> Map.put("@odata.etag", etag()))
          json(conn, 200, graph(id))
        end
    end
  end

  defp graph(conn, "DELETE", ["me", "events", id], _) do
    Agent.update(__MODULE__, &update_in(&1, [:graph], fn g -> Map.delete(g, id) end))
    send_resp(conn, 204, "")
  end

  defp graph(conn, _, _, _), do: json(conn, 404, %{error: %{code: "ErrorItemNotFound"}})

  defp json(conn, status, data), do: conn |> put_resp_content_type("application/json") |> send_resp(status, Jason.encode!(data))
end
