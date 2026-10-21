defmodule Family.Repo.Migrations.AddBubbles.Bubble do
  # The bubble as it is in this migration, so values are stored the way Ecto
  # stores them (a plain map would put booleans in as text).
  use Ecto.Schema

  schema "bubbles" do
    field :name, :string
    field :emoji, :string
    field :home, :boolean
    timestamps(type: :utc_datetime)
  end
end

defmodule Family.Repo.Migrations.AddBubbles do
  use Ecto.Migration
  import Ecto.Query
  alias Family.Repo.Migrations.AddBubbles.Bubble

  # Family bubbles: each household is one, and everyone belongs to one. The
  # people already here become the home bubble, named after the first admin.
  def up do
    create table(:bubbles) do
      add :name, :string, null: false
      add :emoji, :string, null: false, default: "🏡"
      add :home, :boolean, null: false, default: false
      timestamps(type: :utc_datetime)
    end

    alter table(:users) do
      add :bubble_id, references(:bubbles, on_delete: :nilify_all)
    end

    create index(:users, [:bubble_id])
    flush()

    first_admin =
      repo().one(from u in "users", where: u.role == "admin", order_by: u.id, limit: 1, select: u.name)

    if first_admin do
      home = repo().insert!(%Bubble{name: "#{first_admin}'s family", emoji: "🏡", home: true})
      repo().update_all(from(u in "users"), set: [bubble_id: home.id])
    end
  end

  def down do
    alter table(:users) do
      remove :bubble_id
    end

    drop table(:bubbles)
  end
end
