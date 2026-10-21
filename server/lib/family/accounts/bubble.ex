defmodule Family.Accounts.Bubble do
  @moduledoc """
  A family bubble: one household. Everyone belongs to one. The home bubble is
  the family that runs Kitchen Table; friends and cousins come in bubbles of
  their own, and a bubble's grown-ups look after its kids. The home family
  chooses which features each other bubble has (see Family.Permissions).
  """
  use Ecto.Schema
  import Ecto.Changeset

  schema "bubbles" do
    field :name, :string
    field :emoji, :string, default: "🏡"
    field :home, :boolean, default: false
    field :features, :map, default: %{}
    has_many :users, Family.Accounts.User
    timestamps(type: :utc_datetime)
  end

  def changeset(bubble, attrs) do
    bubble
    |> cast(attrs, [:name, :emoji])
    |> update_change(:name, &(&1 && String.trim(&1)))
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 50)
    |> validate_length(:emoji, min: 1, max: 16)
    |> put_features(attrs["features"])
  end

  # The home bubble always has everything, so only other bubbles keep switches.
  defp put_features(changeset, features) when is_map(features) do
    if get_field(changeset, :home) do
      changeset
    else
      kept = get_field(changeset, :features) || %{}
      put_change(changeset, :features, Map.merge(kept, Family.Permissions.clean_features(features)))
    end
  end

  defp put_features(changeset, _), do: changeset
end
