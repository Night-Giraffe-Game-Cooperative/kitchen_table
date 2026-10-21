defmodule Family.Repo.Migrations.AddRelativesAndFriendships do
  use Ecto.Migration

  def change do
    # Grown-ups from other households who are family to a household's kids
    # (grandparents, aunts and uncles), so they can chat with them.
    create table(:bubble_relatives) do
      add :bubble_id, references(:bubbles, on_delete: :delete_all), null: false
      add :user_id, references(:users, on_delete: :delete_all), null: false
      timestamps(type: :utc_datetime)
    end

    create unique_index(:bubble_relatives, [:bubble_id, :user_id])
    create index(:bubble_relatives, [:user_id])

    # Two kids from different households who may chat, once a guardian from
    # each household has said yes. kid_id is always the smaller id.
    create table(:friendships) do
      add :kid_id, references(:users, on_delete: :delete_all), null: false
      add :friend_id, references(:users, on_delete: :delete_all), null: false
      add :kid_ok_by_id, references(:users, on_delete: :nilify_all)
      add :friend_ok_by_id, references(:users, on_delete: :nilify_all)
      add :asked_by_id, references(:users, on_delete: :nilify_all)
      timestamps(type: :utc_datetime)
    end

    create unique_index(:friendships, [:kid_id, :friend_id])
    create index(:friendships, [:friend_id])
  end
end
