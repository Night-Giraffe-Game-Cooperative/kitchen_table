defmodule Family.Repo.Migrations.AddCalendarAccounts do
  use Ecto.Migration

  def change do
    # A Google or Microsoft account someone signed in to, so its calendars can
    # be linked both ways. Its tokens are sealed with Family.Calendar.Vault.
    create table(:calendar_accounts) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :provider, :string, null: false
      add :email, :string
      add :secret, :binary
      add :access, :binary
      add :expires_at, :utc_datetime
      timestamps(type: :utc_datetime)
    end

    create index(:calendar_accounts, [:user_id])

    alter table(:calendar_links) do
      add :account_id, references(:calendar_accounts, on_delete: :delete_all)
    end

    create index(:calendar_links, [:account_id])
  end
end
