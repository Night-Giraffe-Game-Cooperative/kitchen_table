defmodule FamilyWeb.PushController do
  use FamilyWeb, :controller
  alias Family.{Accounts, Push}

  def show(conn, _) do
    json(conn, %{key: Push.public_key(), devices: Push.devices(conn.assigns.current_user)})
  end

  def subscribe(conn, %{"subscription" => sub} = params) when is_map(sub) do
    token_id = Accounts.session_id(conn.assigns.session_token)

    with :ok <- Push.subscribe(conn.assigns.current_user, token_id, Map.merge(sub, Map.take(params, ~w(device replaces)))) do
      json(conn, %{devices: Push.devices(conn.assigns.current_user)})
    end
  end

  def subscribe(_, _), do: {:error, "That device's notification details don't look right."}

  def unsubscribe(conn, %{"endpoint" => endpoint}) when is_binary(endpoint) do
    :ok = Push.unsubscribe(conn.assigns.current_user, endpoint)
    json(conn, %{devices: Push.devices(conn.assigns.current_user)})
  end

  def unsubscribe(_, _), do: {:error, "Which device?"}

  def remove_device(conn, %{"id" => id}) do
    :ok = Push.remove_device(conn.assigns.current_user, String.to_integer(id))
    json(conn, %{devices: Push.devices(conn.assigns.current_user)})
  end

  def test(conn, %{"endpoint" => endpoint}) when is_binary(endpoint) do
    with :ok <- Push.test(conn.assigns.current_user, endpoint), do: json(conn, %{ok: true})
  end

  def test(_, _), do: {:error, "Which device?"}

  def mute(conn, %{"id" => id, "muted" => muted}) when is_boolean(muted) do
    with :ok <- Push.mute(conn.assigns.current_user, String.to_integer(id), muted), do: json(conn, %{muted: muted})
  end

  def mute(_, _), do: {:error, "Say whether to mute it."}
end
