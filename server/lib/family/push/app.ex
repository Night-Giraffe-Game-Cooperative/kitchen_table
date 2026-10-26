defmodule Family.Push.App do
  @moduledoc """
  Notifications for the Kitchen Table Android app (android/). Its web view
  has no push service, and the family would rather not go through Google's,
  so the app comes and fetches them itself: about every minute while it's
  open or in the background, otherwise every 15 minutes or so, as Android
  allows. Until then they wait here, standing in for a push service.

  An app device is a subscription like a browser's, with an address starting
  `app:` and no keys. It proves which one it is with a random key, given to
  it once when notifications are switched on; only a hash of that is kept.
  """

  import Ecto.Query
  alias Family.Repo
  alias Family.Push.{Inbox, Subscription}

  # The most waiting for one device, and the longest any waits.
  @most 50
  @longest 3 * 86_400
  # A chat's messages keep their last few, to join up in one notification.
  @lines 5

  def app?(%Subscription{endpoint: "app:" <> _}), do: true
  def app?(_), do: false

  @doc "A new app device: its address, the key to give it, and the hash of that key to keep."
  def new_device do
    key = :crypto.strong_rand_bytes(32)
    {"app:" <> b64(:crypto.strong_rand_bytes(12)), b64(key), :crypto.hash(:sha256, key)}
  end

  @doc "The hash kept for a key an app gives, or nil if it isn't one."
  def key_hash(key) when is_binary(key) do
    case Base.url_decode64(key, padding: false) do
      {:ok, <<_::binary-32>> = raw} -> :crypto.hash(:sha256, raw)
      _ -> nil
    end
  end

  def key_hash(_), do: nil

  @doc """
  Keeps a notification for the device to fetch. As with a push service, a
  newer one on the same `:topic` replaces one still waiting (so a missed call
  replaces the ringing, and your turn replaces a new game), except that a
  chat's messages keep their last few. It waits for `:ttl` seconds at most.
  """
  def send(%Subscription{id: id}, payload, opts) do
    now = DateTime.utc_now(:second)
    ttl = opts |> Keyword.get(:ttl, 86_400) |> min(@longest)
    topic = opts[:topic]

    if topic do
      keep = if payload[:kind] == "message", do: @lines - 1, else: 0
      older = Repo.all(from i in Inbox, where: i.subscription_id == ^id and i.topic == ^topic, order_by: [desc: i.id], select: i.id)
      replaced = Enum.drop(older, keep)
      if replaced != [], do: Repo.delete_all(from i in Inbox, where: i.id in ^replaced)
    end

    Repo.insert!(%Inbox{subscription_id: id, topic: topic, payload: Jason.encode!(payload), expires_at: DateTime.add(now, ttl)})

    # Out of date ones go, and the oldest beyond the most a device needs.
    newest = from(i in Inbox, where: i.subscription_id == ^id, order_by: [desc: i.id], limit: @most, select: i.id)
    Repo.delete_all(from i in Inbox, where: i.subscription_id == ^id and (i.expires_at <= ^now or i.id not in subquery(newest)))
    :ok
  end

  @doc """
  What's waiting for a device, oldest first, as the JSON a browser would get
  plus each one's `id`. The app says which ids it has already shown (`seen`),
  so those go; one lost on the way is fetched again rather than missed.
  """
  def take(%Subscription{id: id} = sub, seen) do
    now = DateTime.utc_now(:second)
    if seen != [], do: Repo.delete_all(from i in Inbox, where: i.subscription_id == ^id and i.id in ^seen)
    Repo.delete_all(from i in Inbox, where: i.subscription_id == ^id and i.expires_at <= ^now)

    # An app device is in use when it checks, so that's when it was last used
    # (written now and then, not every minute).
    if is_nil(sub.last_used_at) or DateTime.diff(now, sub.last_used_at) > 600 do
      Repo.update_all(from(s in Subscription, where: s.id == ^id), set: [last_used_at: now])
    end

    from(i in Inbox, where: i.subscription_id == ^id, order_by: i.id, limit: @most)
    |> Repo.all()
    |> Enum.map(&Map.put(Jason.decode!(&1.payload), "id", &1.id))
  end

  @doc "Drops everything waiting for a device, such as when someone else signs in on it."
  def forget(%Subscription{id: id}) do
    Repo.delete_all(from i in Inbox, where: i.subscription_id == ^id)
    :ok
  end

  defp b64(bin), do: Base.url_encode64(bin, padding: false)
end
