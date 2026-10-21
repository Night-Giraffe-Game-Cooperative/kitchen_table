defmodule FamilyWeb.FriendController do
  use FamilyWeb, :controller
  alias Family.Contacts

  def ask(conn, %{"kid_id" => kid, "friend_id" => friend}) do
    with {:ok, friendship} <- Contacts.ask(conn.assigns.current_user, kid, friend), do: json(conn, %{friendship: Present.friendship(friendship)})
  end

  def approve(conn, %{"id" => id}) do
    with {:ok, friendship} <- Contacts.approve(conn.assigns.current_user, String.to_integer(id)),
         do: json(conn, %{friendship: Present.friendship(friendship)})
  end

  def remove(conn, %{"id" => id}) do
    with :ok <- Contacts.remove(conn.assigns.current_user, String.to_integer(id)), do: json(conn, %{ok: true})
  end
end
