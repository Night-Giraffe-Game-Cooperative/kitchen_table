defmodule FamilyWeb.UserSocket do
  use Phoenix.Socket
  alias Family.Accounts

  channel "user:*", FamilyWeb.UserChannel
  channel "room:*", FamilyWeb.RoomChannel
  channel "game:*", FamilyWeb.GameChannel
  channel "call:*", FamilyWeb.CallChannel
  channel "family:presence", FamilyWeb.PresenceChannel

  @impl true
  def connect(%{"token" => token}, socket, _info) do
    with {:ok, user_id} <- Phoenix.Token.verify(socket, "user socket", token, max_age: 30 * 86_400),
         %{active: true, must_change_password: false} = user <- Accounts.get_user(user_id) do
      {:ok, assign(socket, :user_id, user.id)}
    else
      _ -> :error
    end
  end

  def connect(_, _, _), do: :error

  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.user_id}"

  def current_user(socket), do: Accounts.get_user(socket.assigns.user_id)
end
