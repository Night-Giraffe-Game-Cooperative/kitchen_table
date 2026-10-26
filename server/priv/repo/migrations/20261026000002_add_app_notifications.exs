defmodule Family.Repo.Migrations.AddAppNotifications do
  use Ecto.Migration

  def change do
    # The Kitchen Table Android app has no push service to send to, so it
    # fetches its notifications itself. It says which device it is with a
    # random key it was given once; only a hash of the key is kept.
    alter table(:push_subscriptions) do
      add :secret_hash, :binary
    end

    create unique_index(:push_subscriptions, [:secret_hash])

    # Notifications waiting for the app to fetch them, each until it's too
    # old to matter. A newer one on the same topic replaces an older one.
    create table(:push_inbox) do
      add :subscription_id, references(:push_subscriptions, on_delete: :delete_all), null: false
      add :topic, :string
      add :payload, :text, null: false
      add :expires_at, :utc_datetime, null: false
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create index(:push_inbox, [:subscription_id])
  end
end
