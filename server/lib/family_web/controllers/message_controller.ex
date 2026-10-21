defmodule FamilyWeb.MessageController do
  use FamilyWeb, :controller
  alias Family.Chat

  def index(conn, %{"id" => room_id} = params) do
    user = conn.assigns.current_user
    room_id = String.to_integer(room_id)

    if Chat.can_read?(user, room_id) do
      before = with b when is_binary(b) <- params["before"], {n, ""} <- Integer.parse(b), do: n, else: (_ -> nil)
      json(conn, %{messages: Chat.list_messages(room_id, before)})
    else
      {:error, :not_found}
    end
  end

  def create(conn, %{"id" => room_id} = params) do
    with {:ok, message} <- Chat.post_message(conn.assigns.current_user, String.to_integer(room_id), params) do
      json(conn, %{message: Present.message(message)})
    end
  end

  def read(conn, %{"id" => room_id, "message_id" => message_id}) do
    Chat.mark_read(conn.assigns.current_user, String.to_integer(room_id), message_id)
    json(conn, %{ok: true})
  end

  def delete(conn, %{"id" => id}) do
    with :ok <- Chat.delete_message(conn.assigns.current_user, String.to_integer(id)) do
      json(conn, %{ok: true})
    end
  end

  def react(conn, %{"id" => id, "emoji" => emoji}) do
    with :ok <- Chat.toggle_reaction(conn.assigns.current_user, String.to_integer(id), emoji) do
      json(conn, %{ok: true})
    end
  end
end
