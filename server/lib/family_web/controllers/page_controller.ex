defmodule FamilyWeb.PageController do
  use FamilyWeb, :controller

  @doc """
  What the app keeps and what it does with linked calendars, in plain words.
  A page of its own, so Google and Microsoft can link to it from their
  sign-in screens and anyone can read it without signing in.
  """
  def privacy(conn, _params) do
    conn
    |> put_resp_header("cache-control", "public, max-age=3600")
    |> put_resp_content_type("text/html")
    |> send_resp(200, FamilyWeb.Privacy.page())
  end

  # Every other address gets the web app, which does its own routing.
  def index(conn, %{"path" => path}) do
    index = Application.app_dir(:family, "priv/static/index.html")

    cond do
      match?(["api" | _], path) ->
        conn |> put_status(404) |> json(%{error: "Not found"})

      File.exists?(index) ->
        conn
        |> put_resp_header("cache-control", "no-cache")
        |> put_resp_content_type("text/html")
        |> send_file(200, index)

      true ->
        conn
        |> put_resp_content_type("text/plain")
        |> send_resp(503, "The web app hasn't been built yet. Run: npm --prefix web run build")
    end
  end
end
