defmodule Family.Games.Game do
  use Ecto.Schema

  schema "games" do
    belongs_to :room, Family.Chat.Room
    belongs_to :created_by, Family.Accounts.User
    field :type, :string
    field :mode, :string
    field :status, :string, default: "active"
    field :title, :string
    field :seats, :map, default: %{}
    field :state, :map, default: %{}
    field :version, :integer, default: 0
    field :summary, :string
    belongs_to :last_move_by, Family.Accounts.User
    timestamps(type: :utc_datetime)
  end
end
