defmodule Family.Settings do
  @moduledoc "A few values the family sets in the app, such as the linked Google calendar."
  use Ecto.Schema
  alias Family.Repo

  @primary_key {:key, :string, autogenerate: false}
  schema "settings" do
    field :value, :string
    timestamps(type: :utc_datetime)
  end

  def get(key), do: with(%__MODULE__{value: v} <- Repo.get(__MODULE__, key), do: v)

  def put(key, nil), do: delete(key)

  def put(key, value) when is_binary(value) do
    Repo.insert!(%__MODULE__{key: key, value: value}, on_conflict: [set: [value: value, updated_at: DateTime.utc_now(:second)]], conflict_target: :key)
    :ok
  end

  def delete(key) do
    with %__MODULE__{} = s <- Repo.get(__MODULE__, key), do: Repo.delete!(s)
    :ok
  end
end
