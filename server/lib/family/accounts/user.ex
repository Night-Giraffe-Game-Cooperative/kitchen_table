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
    # When the morning and evening summaries come (Family.DaySummary):
    # "07:00", "off", or nil for the usual, which is seven and eight in the
    # evening for grown-ups, and never for kids unless they choose a time.
    field :morning, :string
    field :morning_sent_on, :date
    field :evening, :string
    field :evening_sent_on, :date
    field :active, :boolean, default: true
    field :last_seen_at, :utc_datetime
    belongs_to :bubble, Family.Accounts.Bubble
    timestamps(type: :utc_datetime)
  end

  def roles, do: @roles
  def colours, do: @colours

  # A kid without an email of their own signs in with a code a grown-up makes.
  # Their account keeps a stand-in address nobody can send to or guess.
  @no_email "@kids.invalid"

  def no_email?(%__MODULE__{email: email}), do: no_email?(email)
  def no_email?(email) when is_binary(email), do: String.ends_with?(email, @no_email)
  def no_email?(_), do: false

  @doc "Their email, or nil for a kid who has none."
  def email(%__MODULE__{email: email} = user), do: if(no_email?(user), do: nil, else: email)

  defp stand_in, do: "kid-" <> Base.encode16(:crypto.strong_rand_bytes(8), case: :lower) <> @no_email

  def invite_changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email, :role, :colour, :avatar])
    |> kids_need_no_email()
    |> normalise_email()
    |> validate_required([:name, :email, :role])
    |> validate_profile()
    |> validate_inclusion(:role, @roles)
    |> unique_constraint(:email, message: "is already in the family")
  end

  def profile_changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :colour, :avatar, :morning, :evening])
    |> validate_required([:name])
    |> validate_profile()
    |> validate_format(:morning, ~r/\A(off|([01]\d|2[0-3]):[0-5]\d)\z/, message: "needs to be a time, like 07:00")
    |> validate_format(:evening, ~r/\A(off|([01]\d|2[0-3]):[0-5]\d)\z/, message: "needs to be a time, like 20:00")
  end

  def admin_changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email, :role, :colour, :avatar, :active])
    |> kids_need_no_email()
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

  defp kids_need_no_email(changeset) do
    changeset =
      # Saving a kid's details with the email left empty keeps their stand-in.
      if Map.has_key?(changeset.changes, :email) and is_nil(changeset.changes.email) and no_email?(changeset.data),
        do: delete_change(changeset, :email),
        else: changeset

    cond do
      get_field(changeset, :role) == "kid" and is_nil(get_field(changeset, :email)) ->
        put_change(changeset, :email, stand_in())

      get_field(changeset, :role) != "kid" and no_email?(get_field(changeset, :email)) ->
        add_error(changeset, :email, "is needed for a grown-up")

      true ->
        changeset
    end
  end

  defp normalise_email(changeset) do
    changeset
    |> update_change(:email, &(&1 |> String.trim() |> String.downcase()))
    |> validate_format(:email, ~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "doesn't look like an email address")
    |> validate_length(:email, max: 160)
  end
end
