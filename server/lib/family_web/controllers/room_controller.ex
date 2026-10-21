defmodule FamilyWeb.RoomController do
  use FamilyWeb, :controller
  alias Family.Chat

  def index(conn, _) do
    rooms = Chat.list_rooms(conn.assigns.current_user)
    calls = Family.Calls.live(Enum.map(rooms, & &1.id))
    json(conn, %{rooms: Enum.map(rooms, &Map.put(&1, :call, calls[&1.id]))})
  end

  def create(conn, params) do
    with {:ok, room} <- Chat.create_room(conn.assigns.current_user, params) do
      json(conn, %{room_id: room.id})
    end
  end

  def direct(conn, %{"user_id" => other}) do
    with {:ok, room} <- Chat.direct_room(conn.assigns.current_user, String.to_integer(other)) do
      json(conn, %{room_id: room.id})
    end
  end

  def update(conn, %{"id" => id} = params) do
    user = conn.assigns.current_user

    with %{} = room <- Chat.get_room(user, String.to_integer(id)),
         {:ok, _} <- Chat.update_room(user, room, params) do
      json(conn, %{ok: true})
    end
  end
end
