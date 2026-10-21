defmodule Family.Accounts.Token do
  use Ecto.Schema

  schema "user_tokens" do
    belongs_to :user, Family.Accounts.User
    field :token_hash, :binary
    field :context, :string
    field :last_used_at, :utc_datetime
    timestamps(type: :utc_datetime, updated_at: false)
  end
end
