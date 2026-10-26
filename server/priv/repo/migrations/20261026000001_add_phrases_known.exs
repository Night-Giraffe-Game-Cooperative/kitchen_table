defmodule Family.Repo.Migrations.AddPhrasesKnown do
  use Ecto.Migration

  def change do
    # The holiday phrases, signs and characters each person knows, by key,
    # like "ja.thank_you". The phrases themselves live in the web app.
    create table(:phrases_known, primary_key: false) do
      add :user_id, references(:users, on_delete: :delete_all), null: false, primary_key: true
      add :key, :string, null: false, primary_key: true
      timestamps(type: :utc_datetime, updated_at: false)
    end
  end
end
