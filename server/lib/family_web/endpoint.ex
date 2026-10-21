defmodule FamilyWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :family

  socket "/socket", FamilyWeb.UserSocket, websocket: true, longpoll: false

  plug :moved

  # The built web app (npm run build in ../web writes it here).
  plug Plug.Static,
    at: "/",
    from: {:family, "priv/static"},
    gzip: false,
    only: ~w(assets fonts icons textures index.html manifest.webmanifest favicon.svg sw.js robots.txt)

  plug :behind_proxy
  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  plug Plug.Parsers,
    parsers: [:urlencoded, {:multipart, length: 16_000_000}, :json],
    pass: ["*/*"],
    json_decoder: Jason,
    length: 16_000_000

  plug Plug.Head
  plug FamilyWeb.Router

  # On the VPS, Caddy on the same machine serves https and passes requests on.
  # Its headers say who is really asking and that it was over https (so the
  # sign-in cookie is marked secure). Only Caddy is believed.
  defp behind_proxy(conn, _) do
    if Application.get_env(:family, :behind_proxy, false) and loopback?(conn.remote_ip) do
      Plug.RewriteOn.call(conn, [:x_forwarded_for, :x_forwarded_proto])
    else
      conn
    end
  end

  # When Kitchen Table has moved (from the PC to the VPS), MOVED_TO sends
  # everyone to the new address, and the tablet app remembers it.
  defp moved(conn, _) do
    case Application.get_env(:family, :moved_to) do
      nil ->
        conn

      to ->
        query = if conn.query_string == "", do: "", else: "?" <> conn.query_string

        conn
        |> put_resp_header("location", to <> conn.request_path <> query)
        |> send_resp(302, "")
        |> halt()
    end
  end

  defp loopback?({127, _, _, _}), do: true
  defp loopback?({0, 0, 0, 0, 0, 0, 0, 1}), do: true
  defp loopback?(_), do: false
end
