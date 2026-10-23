defmodule Family.Repo.Migrations.AddDaySummaries do
  use Ecto.Migration

  def change do
    alter table(:users) do
      # When the morning and evening summaries come: "07:00", "off", or nil
      # for the usual.
      add :morning, :string
      add :morning_sent_on, :date
      add :evening, :string
      add :evening_sent_on, :date
    end
  end
end
