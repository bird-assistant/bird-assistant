"""Species candidate head for the week-1 feasibility test.

Deliberately limited: torchvision ImageNet weights restricted to ImageNet's
59 bird classes. It answers "can a detector crop be turned into a ranked
candidate list on CPU in real time?" without any fine-tuning. The vocabulary is
far too small for a real product (blue tit is not an ImageNet class) - see
docs/visual-findings.md for the iNat/BioCLIP follow-up.
"""

from __future__ import annotations

import numpy as np
import torch
from torchvision.transforms import v2 as T
from torchvision.models import (
    EfficientNet_B0_Weights,
    ResNet50_Weights,
    efficientnet_b0,
    resnet50,
)

# ImageNet-1k synset names that are birds (59 of 1000).
IMAGENET_BIRD_NAMES = [
    "cock", "hen", "ostrich", "brambling", "goldfinch", "house finch",
    "junco", "indigo bunting", "robin", "bulbul", "jay", "magpie", "chickadee",
    "water ouzel", "kite", "bald eagle", "vulture", "great grey owl",
    "black grouse", "ptarmigan", "ruffed grouse", "prairie chicken", "peacock",
    "quail", "partridge", "African grey", "macaw", "sulphur-crested cockatoo",
    "lorikeet", "coucal", "bee eater", "hornbill", "hummingbird", "jacamar",
    "toucan", "drake", "red-breasted merganser", "goose", "black swan",
    "white stork", "black stork", "spoonbill", "flamingo", "little blue heron",
    "American egret", "bittern", "crane bird", "limpkin", "European gallinule",
    "American coot", "bustard", "ruddy turnstone", "red-backed sandpiper",
    "redshank", "dowitcher", "oystercatcher", "pelican", "king penguin",
    "albatross",
]

_MODELS = {
    "resnet50": (resnet50, ResNet50_Weights.IMAGENET1K_V2),
    "efficientnet_b0": (efficientnet_b0, EfficientNet_B0_Weights.IMAGENET1K_V1),
}


class ImageNetBirdClassifier:
    """Top-k bird candidates from an ImageNet backbone, CPU friendly."""

    def __init__(self, model_name: str = "resnet50", device: str = "cpu", batch_size: int = 8):
        if model_name not in _MODELS:
            raise ValueError(f"unknown classifier {model_name!r}, pick from {list(_MODELS)}")
        factory, weights = _MODELS[model_name]
        self.model_name = model_name
        self.device = torch.device(device)
        self.batch_size = batch_size
        self.model = factory(weights=weights).to(self.device).eval()
        self.categories = list(weights.meta["categories"])
        missing = [n for n in IMAGENET_BIRD_NAMES if n not in self.categories]
        if missing:
            raise RuntimeError(f"bird synsets missing from weights metadata: {missing}")
        self.bird_idx = [self.categories.index(n) for n in IMAGENET_BIRD_NAMES]
        self.names = IMAGENET_BIRD_NAMES
        self.tf = T.Compose(
            [
                T.Resize(256, antialias=True),
                T.CenterCrop(224),
                T.ToDtype(torch.float32, scale=True),
                T.Normalize(
                    mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]
                ),
            ]
        )

    @torch.inference_mode()
    def predict(self, crops: list[np.ndarray], topk: int = 5) -> list[list[tuple[str, float]]]:
        """crops are BGR uint8 arrays. Returns per-crop [(name, prob), ...]."""
        results: list[list[tuple[str, float]]] = []
        for start in range(0, len(crops), self.batch_size):
            chunk = crops[start : start + self.batch_size]
            batch = torch.stack(
                [
                    self.tf(
                        torch.from_numpy(
                            np.ascontiguousarray(cv2_bgr_to_rgb(c))
                        ).permute(2, 0, 1)
                    )
                    for c in chunk
                ]
            ).to(self.device)
            logits = self.model(batch)[:, self.bird_idx]
            probs = logits.softmax(dim=1)
            k = min(topk, probs.shape[1])
            top_p, top_i = probs.topk(k, dim=1)
            for p_row, i_row in zip(top_p.tolist(), top_i.tolist()):
                results.append(
                    [(self.names[i], round(float(p), 4)) for i, p in zip(i_row, p_row)]
                )
        return results


def cv2_bgr_to_rgb(img: np.ndarray) -> np.ndarray:
    import cv2

    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
