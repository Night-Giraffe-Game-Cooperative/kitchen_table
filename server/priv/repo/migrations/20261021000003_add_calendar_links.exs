defmodule Family.Repo.Migrations.AddCalendarLinks do
  use Ecto.Migration

  def change do
    # Calendars kept elsewhere (iCloud, Fastmail, a school's feed) that the
    # family calendar shows, and for CalDAV ones, adds to.
    create table(:calendar_links) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :provider, :string, null: false
      add :name, :string, null: false
      add :url, :string, null: false
      add :username, :string
      add :secret, :binary
      add :share, :string, null: false, default: "family"
      add :color, :string
      add :writable, :boolean, null: false, default: false
      add :default, :boolean, null: false, default: false
      add :ctag, :string
      add :synced_on, :date
      add :last_synced_at, :utc_datetime
      add :last_error, :string
      timestamps(type: :utc_datetime)
    end

    create index(:calendar_links, [:user_id])

    alter table(:calendar_events) do
      add :link_id, references(:calendar_links, on_delete: :delete_all)
      add :remote_uid, :string
      add :remote_key, :string
      add :remote_href, :string
      add :remote_etag, :string
      add :recurring, :boolean, null: false, default: false
    end

    create index(:calendar_events, [:link_id])

    # Linking Google with a service account is gone; Google calendars come
    # back as linked calendars. Events that came from it stay, as the
    # family's own, since some were made here and moved to Google.
    execute "UPDATE calendar_events SET source = 'app', google_id = NULL WHERE source = 'google'", ""
    execute "DELETE FROM settings WHERE key IN ('google_key', 'google_calendar_id', 'google_calendar_name')", ""
  end
end
