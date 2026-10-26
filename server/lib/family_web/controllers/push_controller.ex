defmodule FamilyWeb.PushController do
  use FamilyWeb, :controller
  alias Family.{Accounts, Push, RateLimit}

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

  @doc "The Android app switching on notifications on its device, or saying again that they're on."
  def app(conn, params) do
    token_id = Accounts.session_id(conn.assigns.session_token)
    with {:ok, device} <- Push.subscribe_app(conn.assigns.current_user, token_id, Map.take(params, ~w(token device))) do
      json(conn, Map.put(device, :devices, Push.devices(conn.assigns.current_user)))
    end
  end

  @doc """
  The Android app fetching what's waiting for it. It signs in with its own
  key rather than the cookie, since it checks long after the page has gone,
  and says which it has already shown (`seen`, ids like "12,13").
  """
  def inbox(conn, params) do
    with :ok <- RateLimit.hit({:inbox, conn.remote_ip}, 120, :timer.minutes(1)),
         ["Bearer " <> key] <- get_req_header(conn, "authorization"),
         {:ok, notifications} <- Push.inbox(String.trim(key), seen(params["seen"])) do
      json(conn, %{notifications: notifications})
    else
      {:error, :rate_limited} -> conn |> put_status(429) |> json(%{error: "Too many checks. Try again in a minute."})
      _ -> conn |> put_status(401) |> json(%{error: "unknown_device"})
    end
  end

  defp seen(value) when is_binary(value) do
    for part <- value |> String.split(",", trim: true) |> Enum.take(100), {n, ""} <- [Integer.parse(part)], do: n
  end

  defp seen(_), do: []

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
