defmodule FamilyWeb.MediaController do
  use FamilyWeb, :controller
  alias Family.Chat

  def create(conn, %{"id" => room_id, "file" => %Plug.Upload{} = upload} = params) do
    with {:ok, media} <-
           Chat.store_media(conn.assigns.current_user, String.to_integer(room_id), upload, params) do
      json(conn, %{media: Present.media(media), media_id: media.id})
    end
  end

  def create(_conn, _), do: {:error, "Choose a photo to send."}

  def show(conn, %{"key" => key}) do
    with %{} = user <- conn.assigns.current_user,
         false <- user.must_change_password,
         %{} = media <- Chat.get_media_for(user, key) do
      conn
      |> put_resp_content_type(media.content_type, nil)
      |> put_resp_header("cache-control", "private, max-age=31536000, immutable")
      |> put_resp_header("x-content-type-options", "nosniff")
      |> send_file(200, Chat.media_path(media.key, media.content_type))
    else
      _ -> conn |> put_status(404) |> json(%{error: "Not found"})
    end
  end
end
