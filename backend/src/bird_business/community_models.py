from datetime import date as CalendarDate
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Key = Annotated[str, Field(min_length=1, max_length=128)]
Text = Annotated[str, Field(min_length=1, max_length=2000)]
Label = Annotated[str, Field(max_length=100)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Point(Input):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    system: Literal["GCJ-02", "WGS84"]


class Camera(Input):
    device: Label = ""
    make: Label = ""
    model: Label = ""
    exposure: Label = ""
    aperture: Label = ""
    iso: Label = ""
    focal: Label = ""
    resolution: Label = ""
    lens: Label = ""
    whiteBalance: Label = ""
    exposureBias: Label = ""
    metering: Label = ""
    flash: Label = ""
    lighting: Label = ""
    focusMode: Label = ""


class Sighting(Input):
    reference: Key
    species: Key | None = None
    analysis: Key | None = None
    target: int | None = Field(None, ge=1)
    media: Key | None = None
    date: CalendarDate | None = None
    time: str = Field("", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$|^$")
    place: Label = ""
    point: Point | None = None
    camera: Camera = Field(default_factory=Camera)
    note: str = Field("", max_length=2000)


MAX_POST_IMAGES = 9
MAX_POST_JOURNALS = 3


class GalleryImage(Input):
    media: Key
    kind: Literal["photo", "journal"] = "photo"
    label: Label = "照片"
    manual_camera: Camera = Field(default_factory=Camera)


class Preview(Input):
    identification_help: bool = False
    species: Key | None = None
    external: Key | None = None
    sighting: Key | None = None
    media: Key | None = None
    gallery: list[GalleryImage] = Field(default_factory=list, max_length=MAX_POST_IMAGES)
    title: Label = ""
    body: str = Field("", max_length=2000)
    anonymous: bool = True
    share_camera: bool = False
    share_date: bool = False
    share_photo: bool = False
    channels: set[Literal["post", "map"]] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_content(self):
        if self.gallery:
            if not self.share_photo or self.sighting or self.channels != {"post"}:
                raise ValueError("gallery requires a discussion post with shared photos")
            if self.media and self.media != self.gallery[0].media:
                raise ValueError("cover must be the first gallery image")
            if sum(image.kind == "journal" for image in self.gallery) > MAX_POST_JOURNALS:
                raise ValueError("too many journal images")
        if self.species and (self.sighting or self.external or self.channels != {"post"}):
            raise ValueError("topic species applies only to standalone discussion posts")
        if not self.sighting and not self.body:
            raise ValueError("a sighting or message is required")
        return self


class Submit(Input):
    preview: Key


class Reply(Input):
    identification_vote: bool = False
    body: Text
    reference: Key
    species: Key | None = None
    parentId: Key | None = None


class Message(Input):
    body: Text
    reference: Key


class Report(Input):
    reason: Text


class Decision(Input):
    status: Literal["approved", "rejected"]


class Adopt(Input):
    reply: Key


class BirdChoice(Input):
    species: Key
