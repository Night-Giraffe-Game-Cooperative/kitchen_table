defmodule Family.Calendar.Account do
  @moduledoc """
  A Google or Microsoft account someone signed in to from Linked calendars.
  Its calendars become links (Family.Calendar.Link) that share it.
  """
  use Ecto.Schema

  schema "calendar_accounts" do
    belongs_to :user, Family.Accounts.User
    field :provider, :string
    field :email, :string
    # The refresh token, and the latest access token, sealed with
    # Family.Calendar.Vault. Never sent anywhere but back to the provider.
    field :secret, :binary, redact: true
    field :access, :binary, redact: true
    field :expires_at, :utc_datetime
    has_many :links, Family.Calendar.Link
    timestamps(type: :utc_datetime)
  end
end
