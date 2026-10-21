defmodule Family.Repo.Migrations.AddBubbleFeatures do
  use Ecto.Migration
  import Ecto.Query

  # What the home family lets each other bubble use. Admins now only ever come
  # from the home bubble, so an admin moved to another bubble before this rule
  # becomes a grown-up there, as long as an admin is still left at home.
  def up do
    alter table(:bubbles) do
      add :features, :map
    end

    flush()

    home = repo().one(from b in "bubbles", where: b.home, select: b.id, limit: 1)

    if home do
      at_home = repo().aggregate(from(u in "users", where: u.role == "admin" and u.active and u.bubble_id == ^home), :count)

      if at_home > 0 do
        repo().update_all(
          from(u in "users", where: u.role == "admin" and (is_nil(u.bubble_id) or u.bubble_id != ^home)),
          set: [role: "grownup"]
        )
      end
    end
  end

  def down do
    alter table(:bubbles) do
      remove :features
    end
  end
end
