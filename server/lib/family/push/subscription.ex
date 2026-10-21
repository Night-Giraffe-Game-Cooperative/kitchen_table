defmodule Family.Push.Subscription do
  use Ecto.Schema

  schema "push_subscriptions" do
    belongs_to :user, Family.Accounts.User
    belongs_to :token, Family.Accounts.Token
    field :endpoint, :string, redact: true
    field :p256dh, :string, redact: true
    field :auth, :string, redact: true
    field :device, :string
    field :last_used_at, :utc_datetime
    timestamps(type: :utc_datetime)
  end
end
