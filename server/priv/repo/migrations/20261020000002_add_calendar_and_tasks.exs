defmodule Family.Repo.Migrations.AddCalendarAndTasks do
  use Ecto.Migration

  # The family calendar, daily tasks, and a small store of settings (the
  # Google calendar it's linked to).
  def change do
    create table(:calendar_events) do
      add :title, :string, null: false
      add :emoji, :string, null: false, default: "📅"
      add :notes, :text
      add :location, :string
      add :all_day, :boolean, null: false, default: false
      add :starts_at, :utc_datetime
      add :ends_at, :utc_datetime
      add :start_date, :date
      add :end_date, :date
      add :time_zone, :string, null: false, default: "Europe/London"
      add :repeat, :string, null: false, default: "none"
      add :repeat_until, :date
      add :who, :text, null: false, default: "[]"
      add :source, :string, null: false, default: "app"
      add :google_id, :string
      add :google_recurring_id, :string
      add :google_etag, :string
      add :created_by_id, references(:users, on_delete: :nilify_all)
      timestamps(type: :utc_datetime)
    end

    create unique_index(:calendar_events, [:google_id])
    create index(:calendar_events, [:starts_at])
    create index(:calendar_events, [:start_date])

    create table(:tasks) do
      add :title, :string, null: false
      add :emoji, :string, null: false, default: "✅"
      add :user_ids, :text, null: false, default: "[]"
      add :days, :text, null: false, default: "[]"
      add :on_date, :date
      add :part, :string, null: false, default: "any"
      add :created_by_id, references(:users, on_delete: :nilify_all)
      timestamps(type: :utc_datetime)
    end

    create table(:task_completions) do
      add :task_id, references(:tasks, on_delete: :delete_all), null: false
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :on, :date, null: false
      add :done_by_id, references(:users, on_delete: :nilify_all)
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:task_completions, [:task_id, :user_id, :on])
    create index(:task_completions, [:on])

    create table(:settings, primary_key: false) do
      add :key, :string, primary_key: true
      add :value, :text
      timestamps(type: :utc_datetime)
    end
  end
end
