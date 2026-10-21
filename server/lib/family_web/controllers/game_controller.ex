defmodule FamilyWeb.GameController do
  use FamilyWeb, :controller
  alias Family.Games

  def index(conn, _), do: json(conn, %{games: Games.list_for(conn.assigns.current_user)})

  def show(conn, %{"id" => id}) do
    with %{} = game <- Games.get_for(conn.assigns.current_user, String.to_integer(id)) do
      json(conn, %{game: Present.game(game)})
    end
  end

  def create(conn, %{"id" => room_id} = params) do
    with {:ok, game} <- Games.create(conn.assigns.current_user, String.to_integer(room_id), params) do
      json(conn, %{game: Present.game(game)})
    end
  end

  def move(conn, %{"id" => id} = params) do
    with {:ok, game} <- Games.move(conn.assigns.current_user, String.to_integer(id), params) do
      json(conn, %{game: Present.game(game)})
    end
  end

  def remove(conn, %{"id" => id}) do
    with {:ok, stopped} <- Games.remove(conn.assigns.current_user, String.to_integer(id)), do: json(conn, %{ok: true, stopped: stopped})
  end

  def join(conn, %{"id" => id, "seat" => seat}) do
    with {:ok, game} <- Games.join(conn.assigns.current_user, String.to_integer(id), seat) do
      json(conn, %{game: Present.game(game)})
    end
  end
end
