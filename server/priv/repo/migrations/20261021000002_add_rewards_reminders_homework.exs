defmodule Family.Repo.Migrations.AddRewardsRemindersHomework do
  use Ecto.Migration

  # Tasks gain kinds (a job, a reminder for grown-ups about a child, or
  # homework) and rewards (stars, pocket money, a sticker). Each tick keeps the
  # reward it earned, so changing a task later doesn't rewrite the past.
  def change do
    alter table(:tasks) do
      add :kind, :string, null: false, default: "job"
      add :stars, :integer, null: false, default: 1
      add :pence, :integer, null: false, default: 0
      add :sticker, :boolean, null: false, default: false
      add :notes, :string
      add :subject, :string
      add :due_on, :date
      add :status, :string
    end

    alter table(:task_completions) do
      add :stars, :integer, null: false, default: 1
      add :pence, :integer, null: false, default: 0
      add :sticker, :string
    end

    create table(:payouts) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :pence, :integer, null: false
      add :paid_by_id, references(:users, on_delete: :nilify_all)
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create index(:payouts, [:user_id])

    create table(:goals) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :title, :string, null: false
      add :emoji, :string, null: false, default: "🎁"
      add :stars, :integer, null: false
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :given_at, :utc_datetime
      timestamps(type: :utc_datetime)
    end

    create index(:goals, [:user_id])
  end
end
