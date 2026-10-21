defmodule Family.Repo.Migrations.CreateFamily do
  use Ecto.Migration

  def change do
    create table(:users) do
      add :name, :string, null: false
      add :email, :string, null: false
      add :role, :string, null: false
      add :password_hash, :string, null: false
      add :must_change_password, :boolean, null: false, default: true
      add :otp_expires_at, :utc_datetime
      add :colour, :string, null: false, default: "sky"
      add :avatar, :string, null: false, default: "🙂"
      add :permissions, :map, null: false, default: %{}
      add :quiet_hours, :map
      add :active, :boolean, null: false, default: true
      add :last_seen_at, :utc_datetime
      timestamps(type: :utc_datetime)
    end

    create unique_index(:users, [:email])

    create table(:user_tokens) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :token_hash, :binary, null: false
      add :context, :string, null: false
      add :last_used_at, :utc_datetime
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:user_tokens, [:token_hash])
    create index(:user_tokens, [:user_id])

    create table(:rooms) do
      add :name, :string, null: false
      add :kind, :string, null: false
      add :emoji, :string, null: false, default: "💬"
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :last_message_at, :utc_datetime
      timestamps(type: :utc_datetime)
    end

    create table(:room_members) do
      add :room_id, references(:rooms, on_delete: :delete_all), null: false
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :last_read_id, :integer, null: false, default: 0
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:room_members, [:room_id, :user_id])
    create index(:room_members, [:user_id])

    create table(:media) do
      add :user_id, references(:users, on_delete: :nilify_all)
      add :room_id, references(:rooms, on_delete: :delete_all), null: false
      add :key, :string, null: false
      add :content_type, :string, null: false
      add :bytes, :integer, null: false
      add :width, :integer
      add :height, :integer
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:media, [:key])

    create table(:games) do
      add :room_id, references(:rooms, on_delete: :delete_all), null: false
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :type, :string, null: false
      add :mode, :string, null: false
      add :status, :string, null: false, default: "active"
      add :title, :string
      add :seats, :map, null: false, default: %{}
      add :state, :map, null: false, default: %{}
      add :version, :integer, null: false, default: 0
      add :summary, :string
      add :last_move_by_id, references(:users, on_delete: :nilify_all)
      timestamps(type: :utc_datetime)
    end

    create index(:games, [:room_id])

    create table(:messages) do
      add :room_id, references(:rooms, on_delete: :delete_all), null: false
      add :user_id, references(:users, on_delete: :nilify_all)
      add :kind, :string, null: false
      add :body, :text
      add :media_id, references(:media, on_delete: :nilify_all)
      add :game_id, references(:games, on_delete: :nilify_all)
      add :reply_to_id, references(:messages, on_delete: :nilify_all)
      add :data, :map
      add :deleted_at, :utc_datetime
      timestamps(type: :utc_datetime)
    end

    create index(:messages, [:room_id, :id])

    create table(:reactions) do
      add :message_id, references(:messages, on_delete: :delete_all), null: false
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :emoji, :string, null: false
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:reactions, [:message_id, :user_id, :emoji])

    create table(:outbox) do
      add :to, :string, null: false
      add :subject, :string, null: false
      add :body, :text, null: false
      timestamps(type: :utc_datetime, updated_at: false)
    end
  end
end
