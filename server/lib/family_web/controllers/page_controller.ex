defmodule FamilyWeb.PageController do
  use FamilyWeb, :controller

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
