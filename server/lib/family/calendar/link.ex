defmodule Family.Calendar.Link do
  use Ecto.Schema
  import Ecto.Changeset

  # caldav: read and written (iCloud, Fastmail, Nextcloud...).
  # google and microsoft: read and written, through a signed-in account.
  # ics: a calendar's address, read only (Google's or Outlook's secret
  # address, a school's or a club's).
  @providers ~w(caldav google microsoft ics)
  # Everyone who sees the family calendar, or only whoever linked it.
  @shares ~w(family me)

  schema "calendar_links" do
    belongs_to :user, Family.Accounts.User
    # The Google or Microsoft account it's reached through.
    belongs_to :account, Family.Calendar.Account
    field :provider, :string
    field :name, :string
    field :url, :string
    field :username, :string
    # The password, sealed with Family.Calendar.Vault. Never sent anywhere.
    field :secret, :binary, redact: true
    field :share, :string, default: "family"
    field :color, :string
    field :writable, :boolean, default: false
    # New events go here unless someone chooses otherwise.
    field :default, :boolean, default: false
    # What the calendar was like when last copied, to skip copying it again.
    field :ctag, :string
    field :synced_on, :date
    field :last_synced_at, :utc_datetime
    field :last_error, :string
    timestamps(type: :utc_datetime)
  end

  def new_changeset(link, attrs) do
    link
    |> cast(attrs, [:user_id, :account_id, :provider, :name, :url, :username, :secret, :share, :color, :writable, :default])
    |> validate_required([:user_id, :provider, :url])
    |> validate_inclusion(:provider, @providers)
    |> settings()
  end

  def changeset(link, attrs) do
    link
    |> cast(attrs, [:name, :share, :color, :default])
    |> settings()
  end

  defp settings(changeset) do
    changeset
    |> update_change(:name, &(&1 && String.trim(&1)))
    |> validate_required([:name], message: "needs a name")
    |> validate_length(:name, max: 60)
    |> validate_inclusion(:share, @shares)
    |> validate_format(:color, ~r/^#[0-9a-f]{6}$/, message: "needs to be a colour")
    |> then(fn c -> if get_field(c, :share) == "me", do: put_change(c, :default, false), else: c end)
  end
end
