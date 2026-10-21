defmodule Family.Accounts.OneTimePassword do
  @moduledoc """
  One-time passwords a child can type: three short words and two digits,
  such as `otter-maple-drum-42`. About 1.7 billion combinations, and they
  expire after a week.
  """

  @words ~w(
    acorn apple apron arrow badge baker beach berry bison bloom board boat
    bread brick brush bucket bunny cabin cake camel candle canoe cape carrot
    castle cedar chalk cheese cherry chess cider cliff cloud clover coast
    comet coral cosy cotton crab crane crown cubby daisy dance delta denim
    dingo dolphin donkey dream drum duck eagle earth easel ember fable
    feather fern fiddle field finch flute foal forest fox frost garden gecko
    ginger glove goose grape gravy hamster harbour harp hazel heron hippo
    honey hoop igloo island ivy jacket jam jelly jigsaw jumper kayak kettle
    kite kiwi koala ladder lake lamb lantern lemon lily lion llama lobster
    lolly maple marble meadow melon mint mitten moon moose muffin nectar
    nest noodle nutmeg oak oasis ocean olive orbit otter owl paddle panda
    paper parrot peach pebble pencil penguin pepper piano pickle pillow
    pirate pixie planet plum pocket pony poppy pretzel puffin pumpkin puppy
    quail quill rabbit radish raft rainbow raven reef ribbon river robin
    rocket rose saddle sail salmon sandal scarf seal shell sherbet ship
    slipper sloth snail snow sock sparrow spoon squash star stork strudel
    sugar summer swan teapot thistle thunder tiger toast tomato topaz
    tortoise tractor trumpet tulip turnip turtle tuba umbrella valley velvet
    violin waffle walnut walrus whale wheat willow window winter wombat
    yacht yarn yoghurt zebra zigzag
  )

  def generate do
    words = for _ <- 1..3, do: Enum.at(@words, pick(length(@words)))
    digits = pick(90) + 10
    Enum.join(words ++ [Integer.to_string(digits)], "-")
  end

  # These are passwords, so the randomness comes from the operating system.
  defp pick(n), do: :crypto.strong_rand_bytes(4) |> :binary.decode_unsigned() |> rem(n)

  def lifetime_days, do: 7
end
