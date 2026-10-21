defmodule Family.Contacts.Friendship do
  @moduledoc """
  Two kids from different households who want to chat. They may once a
  guardian from each household has said yes. `kid_id` is the smaller id.
  """
  use Ecto.Schema

  schema "friendships" do
    belongs_to :kid, Family.Accounts.User
    belongs_to :friend, Family.Accounts.User
    belongs_to :kid_ok_by, Family.Accounts.User
    belongs_to :friend_ok_by, Family.Accounts.User
    belongs_to :asked_by, Family.Accounts.User
    timestamps(type: :utc_datetime)
  end

  def approved?(%__MODULE__{kid_ok_by_id: a, friend_ok_by_id: b}), do: not is_nil(a) and not is_nil(b)
end
