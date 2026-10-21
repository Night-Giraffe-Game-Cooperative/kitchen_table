defmodule Family.Repo.Migrations.AddHiddenGames do
  use Ecto.Migration

  def change do
    # Games someone has taken off their own Games list.
    create table(:hidden_games, primary_key: false) do
      add :game_id, references(:games, on_delete: :delete_all), null: false, primary_key: true
      add :user_id, references(:users, on_delete: :delete_all), null: false, primary_key: true
      timestamps(type: :utc_datetime, updated_at: false)
    end
  end
end
