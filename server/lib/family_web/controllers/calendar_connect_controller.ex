defmodule FamilyWeb.CalendarConnectController do
  @moduledoc """
  Where Google and Microsoft send someone back to after they sign in to link
  calendars. On to the calendar to pick which ones, or a short page saying
  what went wrong.
  """
  use FamilyWeb, :controller
  alias Family.Calendar.Connect

  def back(conn, %{"provider" => provider} = params) do
    if provider in Connect.providers() do
      case Connect.finish(conn.assigns.current_user, provider, site(conn), params) do
        {:ok, account} -> redirect(conn, to: "/#/calendar/link/#{account.id}")
        {:error, :not_found} -> page(conn, "That account isn't one you linked. Link the calendar again.")
        {:error, :signed_out} -> page(conn, "#{Connect.name(provider)} didn't accept the sign-in. Link the calendar again.")
        {:error, message} when is_binary(message) -> page(conn, message)
        {:error, _} -> page(conn, "Something went wrong signing in. Link the calendar again.")
      end
    else
      page(conn, "That isn't a sign-in this app knows.")
    end
  end

  @doc """
  The address people reach this server at, which Google and Microsoft send
  them back to. Behind Caddy on the VPS it's the site's own address.
  """
  def site(conn) do
    if Application.get_env(:family, :behind_proxy, false) do
      FamilyWeb.Endpoint.url()
    else
      port = if {conn.scheme, conn.port} in [{:http, 80}, {:https, 443}], do: "", else: ":#{conn.port}"
      "#{conn.scheme}://#{conn.host}#{port}"
    end
  end

  defp page(conn, message) do
    message = message |> Plug.HTML.html_escape()

    html = """
    <!doctype html>
    <html lang="en-GB">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Linking a calendar · Kitchen Table</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1rem; box-sizing: border-box;
             font: 1.05rem/1.5 system-ui, sans-serif; background: #fbf7f0; color: #2b2520; }
      main { max-width: 26rem; text-align: center; }
      a { display: inline-block; margin-top: 1rem; padding: .7rem 1.2rem; border-radius: 999px; background: #3b5bdb; color: #fff; text-decoration: none; font-weight: 600; }
      @media (prefers-color-scheme: dark) { body { background: #1d1a17; color: #f1ebe3; } }
    </style>
    </head>
    <body>
    <main>
      <h1>The calendar wasn't linked</h1>
      <p>#{message}</p>
      <a href="/#/calendar/month">Back to Kitchen Table</a>
    </main>
    </body>
    </html>
    """

    conn |> put_resp_content_type("text/html") |> send_resp(400, html)
  end
end
