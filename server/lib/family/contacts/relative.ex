defmodule Family.Contacts.Relative do
  @moduledoc "A grown-up from another household who is family to a household's kids."
  use Ecto.Schema

  schema "bubble_relatives" do
    belongs_to :bubble, Family.Accounts.Bubble
    belongs_to :user, Family.Accounts.User
    timestamps(type: :utc_datetime)
  end
end
