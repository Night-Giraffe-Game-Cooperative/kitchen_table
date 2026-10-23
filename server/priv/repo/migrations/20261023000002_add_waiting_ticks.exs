defmodule Family.Repo.Migrations.AddWaitingTicks do
  use Ecto.Migration

  def change do
    alter table(:task_completions) do
      # A kid's tick on a task a grown-up set, waiting for a grown-up to say
      # it's done. It earns nothing until then.
      add :waiting, :boolean, default: false, null: false
    end
  end
end
