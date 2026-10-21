defmodule Family.Accounts.User do
  use Ecto.Schema
  import Ecto.Changeset

  @roles ~w(admin grownup kid)
  @colours ~w(sky meadow sunflower apricot rose lilac sea slate)

  schema "users" do
    field :name, :string
    field :email, :string
    field :role, :string
    field :password_hash, :string, redact: true
    field :must_change_password, :boolean, default: true
    field :otp_expires_at, :utc_datetime
    field :colour, :string, default: "sky"
    field :avatar, :string, default: "🙂"
    field :permissions, :map, default: %{}
    field :quiet_hours, :map
    field :active, :boolean, default: true
    field :last_seen_at, :utc_datetime
    belongs_to :bubble, Family.Accounts.Bubble
    timestamps(type: :utc_datetime)
  end

  def roles, do: @roles
  def colours, do: @colours

  def invite_changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email, :role, :colour, :avatar])
    |> normalise_email()
    |> validate_required([:name, :email, :role])
    |> validate_profile()
    |> validate_inclusion(:role, @roles)
    |> unique_constraint(:email, message: "is already in the family")
  end

  def profile_changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :colour, :avatar])
    |> validate_required([:name])
    |> validate_profile()
  end

  def admin_changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email, :role, :colour, :avatar, :active])
    |> normalise_email()
    |> validate_required([:name, :email, :role])
    |> validate_profile()
    |> validate_inclusion(:role, @roles)
    |> unique_constraint(:email, message: "is already in the family")
  end

  defp validate_profile(changeset) do
    changeset
    |> update_change(:name, &String.trim/1)
    |> validate_length(:name, min: 1, message: "is needed")
    |> validate_length(:name, max: 40, message: "needs to be 40 characters or fewer")
    |> validate_inclusion(:colour, @colours)
    |> validate_length(:avatar, min: 1, max: 16)
  end

  defp normalise_email(changeset) do
    changeset
    |> update_change(:email, &(&1 |> String.trim() |> String.downcase()))
    |> validate_format(:email, ~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "doesn't look like an email address")
    |> validate_length(:email, max: 160)
  end
end
