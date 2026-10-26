defmodule Family.Repo.Migrations.AddNextRounds do
  use Ecto.Migration

  def change do
    alter table(:games) do
      # The round started from this one with Play again, so everyone still
      # looking at it moves on together.
      add :next_id, :integer
    end
  end
end
