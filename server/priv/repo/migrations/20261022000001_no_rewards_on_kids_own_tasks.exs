defmodule Family.Repo.Migrations.NoRewardsOnKidsOwnTasks do
  use Ecto.Migration

  # Kids' own tasks earn no reward. Tasks kids made before that rule came in
  # could carry a sticker (the old dialog offered one), so they stop paying out.
  def up do
    execute "UPDATE tasks SET stars = 0, pence = 0, sticker = 0 WHERE created_by_id IN (SELECT id FROM users WHERE role = 'kid')"
  end

  def down, do: :ok
end
