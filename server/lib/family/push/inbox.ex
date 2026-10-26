defmodule Family.Push.Inbox do
  @moduledoc "A notification waiting for the Android app to fetch it (`Family.Push.App`)."
  use Ecto.Schema

  schema "push_inbox" do
    belongs_to :subscription, Family.Push.Subscription
    field :topic, :string
    field :payload, :string, redact: true
    field :expires_at, :utc_datetime
    timestamps(type: :utc_datetime, updated_at: false)
  end
end
