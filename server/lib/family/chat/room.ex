defmodule Family.Chat.Room do
  use Ecto.Schema

  schema "rooms" do
    field :name, :string
    field :kind, :string
    field :emoji, :string, default: "💬"
    belongs_to :created_by, Family.Accounts.User
    field :last_message_at, :utc_datetime
    has_many :members, Family.Chat.Member
    timestamps(type: :utc_datetime)
  end
end

defmodule Family.Chat.Member do
  use Ecto.Schema

  schema "room_members" do
    belongs_to :room, Family.Chat.Room
    belongs_to :user, Family.Accounts.User
    field :last_read_id, :integer, default: 0
    field :muted, :boolean, default: false
    timestamps(type: :utc_datetime, updated_at: false)
  end
end

defmodule Family.Chat.Message do
  use Ecto.Schema

  schema "messages" do
    belongs_to :room, Family.Chat.Room
    belongs_to :user, Family.Accounts.User
    field :kind, :string
    field :body, :string
    belongs_to :media, Family.Chat.Media
    belongs_to :game, Family.Games.Game
    belongs_to :reply_to, Family.Chat.Message
    field :data, :map
    field :deleted_at, :utc_datetime
    has_many :reactions, Family.Chat.Reaction
    timestamps(type: :utc_datetime)
  end
end

defmodule Family.Chat.Reaction do
  use Ecto.Schema

  schema "reactions" do
    belongs_to :message, Family.Chat.Message
    belongs_to :user, Family.Accounts.User
    field :emoji, :string
    timestamps(type: :utc_datetime, updated_at: false)
  end
end

defmodule Family.Chat.Media do
  use Ecto.Schema

  schema "media" do
    belongs_to :user, Family.Accounts.User
    belongs_to :room, Family.Chat.Room
    field :key, :string
    field :content_type, :string
    field :bytes, :integer
    field :width, :integer
    field :height, :integer
    timestamps(type: :utc_datetime, updated_at: false)
  end
end
