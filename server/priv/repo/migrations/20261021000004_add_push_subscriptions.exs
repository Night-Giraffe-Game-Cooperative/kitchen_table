defmodule Family.Repo.Migrations.AddPushSubscriptions do
  use Ecto.Migration

  def change do
    # Devices that asked for notifications: where each one's browser said to
    # send them, and the keys to encrypt them with. Each belongs to the
    # session that switched it on, so signing out stops them.
    create table(:push_subscriptions) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :token_id, references(:user_tokens, on_delete: :delete_all), null: false
      add :endpoint, :string, null: false
      add :p256dh, :string, null: false
      add :auth, :string, null: false
      add :device, :string
      add :last_used_at, :utc_datetime
      timestamps(type: :utc_datetime)
    end

    create unique_index(:push_subscriptions, [:endpoint])
    create index(:push_subscriptions, [:user_id])

    # A chat someone has quietened: no notifications for its messages.
    alter table(:room_members) do
      add :muted, :boolean, null: false, default: false
    end
  end
end
