defmodule Family.Repo.Migrations.KeepLearnOn do
  use Ecto.Migration

  # Learn became an optional module, which a new family starts without. A
  # family already using the app keeps it switched on.
  def up do
    execute("""
    INSERT OR IGNORE INTO settings (key, value, inserted_at, updated_at)
    SELECT 'module:learn', 'on', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE EXISTS (SELECT 1 FROM users)
    """)
  end

  def down, do: execute("DELETE FROM settings WHERE key = 'module:learn'")
end
