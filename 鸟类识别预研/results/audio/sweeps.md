# 音频实验明细

## 1. 窗长扫描（干净音频，hop = 窗长/2）

| clip | 期望物种 | 窗长(s) | 窗数 | top-1 | top1 预测 | p | 单窗延迟 p50(ms) |
|---|---|---|---|---|---|---|---|
| A1_blackbird.wav | Turdus merula | 0.5 | 39 | ✗ | Sialia sialis_Eastern Bluebird | 0.9181 | 17.45 |
| A1_blackbird.wav | Turdus merula | 1.0 | 19 | ✓ | Turdus merula_Eurasian Blackbird | 0.9938 | 17.09 |
| A1_blackbird.wav | Turdus merula | 2.0 | 9 | ✓ | Turdus merula_Eurasian Blackbird | 0.9867 | 17.46 |
| A1_blackbird.wav | Turdus merula | 3.0 | 6 | ✓ | Turdus merula_Eurasian Blackbird | 0.9772 | 17.04 |
| A2_greattit.wav | Parus major | 0.5 | 39 | ✗ | Rhipidura albicollis_White-throated Fantail | 0.8002 | 17.34 |
| A2_greattit.wav | Parus major | 1.0 | 19 | ✓ | Parus major_Great Tit | 0.9385 | 17.14 |
| A2_greattit.wav | Parus major | 2.0 | 9 | ✓ | Parus major_Great Tit | 0.9524 | 16.77 |
| A2_greattit.wav | Parus major | 3.0 | 6 | ✓ | Parus major_Great Tit | 0.9652 | 17.36 |
| A3_bluetit.wav | Cyanistes caeruleus | 0.5 | 39 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.948 | 19.52 |
| A3_bluetit.wav | Cyanistes caeruleus | 1.0 | 19 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9954 | 19.97 |
| A3_bluetit.wav | Cyanistes caeruleus | 2.0 | 9 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9997 | 20.19 |
| A3_bluetit.wav | Cyanistes caeruleus | 3.0 | 6 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9996 | 19.67 |
| A4_cuckoo.wav | Cuculus canorus | 0.5 | 39 | ✓ | Cuculus canorus_Common Cuckoo | 0.929 | 19.85 |
| A4_cuckoo.wav | Cuculus canorus | 1.0 | 19 | ✓ | Cuculus canorus_Common Cuckoo | 0.9471 | 20.44 |
| A4_cuckoo.wav | Cuculus canorus | 2.0 | 9 | ✓ | Cuculus canorus_Common Cuckoo | 0.9837 | 20.27 |
| A4_cuckoo.wav | Cuculus canorus | 3.0 | 6 | ✓ | Cuculus canorus_Common Cuckoo | 0.9247 | 20.55 |
| A5_chaffinch.wav | Fringilla coelebs | 0.5 | 39 | ✓ | Fringilla coelebs_Common Chaffinch | 0.8952 | 20.01 |
| A5_chaffinch.wav | Fringilla coelebs | 1.0 | 19 | ✓ | Fringilla coelebs_Common Chaffinch | 0.9356 | 20.1 |
| A5_chaffinch.wav | Fringilla coelebs | 2.0 | 9 | ✓ | Fringilla coelebs_Common Chaffinch | 0.9185 | 20.7 |
| A5_chaffinch.wav | Fringilla coelebs | 3.0 | 6 | ✓ | Fringilla coelebs_Common Chaffinch | 0.9046 | 20.28 |

## 2. 噪声注入（3s 窗，按 SNR 混入真实噪声）

| clip | 噪声 | SNR(dB) | top1 | top1 预测 | p |
|---|---|---|---|---|---|
| A1_blackbird.wav | (none) | - | ✓ | Turdus merula_Eurasian Blackbird | 0.9772 |
| A1_blackbird.wav | N1_speech | 20 | ✓ | Turdus merula_Eurasian Blackbird | 0.8858 |
| A1_blackbird.wav | N1_speech | 10 | ✓ | Turdus merula_Eurasian Blackbird | 0.7791 |
| A1_blackbird.wav | N1_speech | 5 | ✓ | Turdus merula_Eurasian Blackbird | 0.5635 |
| A1_blackbird.wav | N1_speech | 0 | ✓ | Turdus merula_Eurasian Blackbird | 0.409 |
| A1_blackbird.wav | N2_traffic | 20 | ✓ | Turdus merula_Eurasian Blackbird | 0.9769 |
| A1_blackbird.wav | N2_traffic | 10 | ✓ | Turdus merula_Eurasian Blackbird | 0.9746 |
| A1_blackbird.wav | N2_traffic | 5 | ✓ | Turdus merula_Eurasian Blackbird | 0.9668 |
| A1_blackbird.wav | N2_traffic | 0 | ✓ | Turdus merula_Eurasian Blackbird | 0.9732 |
| A1_blackbird.wav | N3_wind_synthetic | 20 | ✓ | Turdus merula_Eurasian Blackbird | 0.9192 |
| A1_blackbird.wav | N3_wind_synthetic | 10 | ✓ | Turdus merula_Eurasian Blackbird | 0.6098 |
| A1_blackbird.wav | N3_wind_synthetic | 5 | ✓ | Turdus merula_Eurasian Blackbird | 0.2024 |
| A1_blackbird.wav | N3_wind_synthetic | 0 | ✓ | Turdus merula_Eurasian Blackbird | 0.065 |
| A2_greattit.wav | (none) | - | ✓ | Parus major_Great Tit | 0.9652 |
| A2_greattit.wav | N1_speech | 20 | ✓ | Parus major_Great Tit | 0.7063 |
| A2_greattit.wav | N1_speech | 10 | ✓ | Parus major_Great Tit | 0.6832 |
| A2_greattit.wav | N1_speech | 5 | ✓ | Parus major_Great Tit | 0.7628 |
| A2_greattit.wav | N1_speech | 0 | ✓ | Parus major_Great Tit | 0.8244 |
| A2_greattit.wav | N2_traffic | 20 | ✓ | Parus major_Great Tit | 0.9701 |
| A2_greattit.wav | N2_traffic | 10 | ✓ | Parus major_Great Tit | 0.9622 |
| A2_greattit.wav | N2_traffic | 5 | ✓ | Parus major_Great Tit | 0.8911 |
| A2_greattit.wav | N2_traffic | 0 | ✓ | Parus major_Great Tit | 0.8258 |
| A2_greattit.wav | N3_wind_synthetic | 20 | ✓ | Parus major_Great Tit | 0.848 |
| A2_greattit.wav | N3_wind_synthetic | 10 | ✓ | Parus major_Great Tit | 0.8119 |
| A2_greattit.wav | N3_wind_synthetic | 5 | ✓ | Parus major_Great Tit | 0.7109 |
| A2_greattit.wav | N3_wind_synthetic | 0 | ✓ | Parus major_Great Tit | 0.6289 |
| A3_bluetit.wav | (none) | - | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9996 |
| A3_bluetit.wav | N1_speech | 20 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9922 |
| A3_bluetit.wav | N1_speech | 10 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9876 |
| A3_bluetit.wav | N1_speech | 5 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9841 |
| A3_bluetit.wav | N1_speech | 0 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9731 |
| A3_bluetit.wav | N2_traffic | 20 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9996 |
| A3_bluetit.wav | N2_traffic | 10 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9995 |
| A3_bluetit.wav | N2_traffic | 5 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9993 |
| A3_bluetit.wav | N2_traffic | 0 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9988 |
| A3_bluetit.wav | N3_wind_synthetic | 20 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9984 |
| A3_bluetit.wav | N3_wind_synthetic | 10 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9795 |
| A3_bluetit.wav | N3_wind_synthetic | 5 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.9552 |
| A3_bluetit.wav | N3_wind_synthetic | 0 | ✓ | Cyanistes caeruleus_Eurasian Blue Tit | 0.8767 |
| A4_cuckoo.wav | (none) | - | ✓ | Cuculus canorus_Common Cuckoo | 0.9247 |
| A4_cuckoo.wav | N1_speech | 20 | ✓ | Cuculus canorus_Common Cuckoo | 0.9316 |
| A4_cuckoo.wav | N1_speech | 10 | ✓ | Cuculus canorus_Common Cuckoo | 0.7716 |
| A4_cuckoo.wav | N1_speech | 5 | ✓ | Cuculus canorus_Common Cuckoo | 0.8016 |
| A4_cuckoo.wav | N1_speech | 0 | ✓ | Cuculus canorus_Common Cuckoo | 0.7823 |
| A4_cuckoo.wav | N2_traffic | 20 | ✓ | Cuculus canorus_Common Cuckoo | 0.9198 |
| A4_cuckoo.wav | N2_traffic | 10 | ✓ | Cuculus canorus_Common Cuckoo | 0.9202 |
| A4_cuckoo.wav | N2_traffic | 5 | ✓ | Cuculus canorus_Common Cuckoo | 0.9104 |
| A4_cuckoo.wav | N2_traffic | 0 | ✓ | Cuculus canorus_Common Cuckoo | 0.8627 |
| A4_cuckoo.wav | N3_wind_synthetic | 20 | ✓ | Cuculus canorus_Common Cuckoo | 0.9239 |
| A4_cuckoo.wav | N3_wind_synthetic | 10 | ✓ | Cuculus canorus_Common Cuckoo | 0.8626 |
| A4_cuckoo.wav | N3_wind_synthetic | 5 | ✓ | Cuculus canorus_Common Cuckoo | 0.8177 |
| A4_cuckoo.wav | N3_wind_synthetic | 0 | ✓ | Cuculus canorus_Common Cuckoo | 0.8524 |
| A5_chaffinch.wav | (none) | - | ✓ | Fringilla coelebs_Common Chaffinch | 0.9046 |
| A5_chaffinch.wav | N1_speech | 20 | ✓ | Fringilla coelebs_Common Chaffinch | 0.7436 |
| A5_chaffinch.wav | N1_speech | 10 | ✓ | Fringilla coelebs_Common Chaffinch | 0.4337 |
| A5_chaffinch.wav | N1_speech | 5 | ✓ | Fringilla coelebs_Common Chaffinch | 0.4337 |
| A5_chaffinch.wav | N1_speech | 0 | ✓ | Fringilla coelebs_Common Chaffinch | 0.4851 |
| A5_chaffinch.wav | N2_traffic | 20 | ✓ | Fringilla coelebs_Common Chaffinch | 0.9056 |
| A5_chaffinch.wav | N2_traffic | 10 | ✓ | Fringilla coelebs_Common Chaffinch | 0.897 |
| A5_chaffinch.wav | N2_traffic | 5 | ✓ | Fringilla coelebs_Common Chaffinch | 0.898 |
| A5_chaffinch.wav | N2_traffic | 0 | ✓ | Fringilla coelebs_Common Chaffinch | 0.8951 |
| A5_chaffinch.wav | N3_wind_synthetic | 20 | ✓ | Fringilla coelebs_Common Chaffinch | 0.6494 |
| A5_chaffinch.wav | N3_wind_synthetic | 10 | ✓ | Fringilla coelebs_Common Chaffinch | 0.585 |
| A5_chaffinch.wav | N3_wind_synthetic | 5 | ✓ | Fringilla coelebs_Common Chaffinch | 0.7041 |
| A5_chaffinch.wav | N3_wind_synthetic | 0 | ✓ | Fringilla coelebs_Common Chaffinch | 0.4872 |

## 3. 负样本（无鸟）

| clip | max p | ≥0.25 误报 | ≥0.5 误报 | top-3 |
|---|---|---|---|---|
| N1_speech.wav | 0.0438 | False | False | Human vocal_Human vocal 0.0438; Gun_Gun 0.0351; Human whistle_Human whistle 0.0139 |
| N2_traffic.wav | 0.4711 | True | False | Puffinus puffinus_Manx Shearwater 0.4711; Porzana porzana_Spotted Crake 0.1311; Larus occidentalis_Western Gull 0.1052 |
| N3_wind_synthetic.wav | 0.2534 | True | False | Psiloscops flammeolus_Flammulated Owl 0.2534; Euphonia luteicapilla_Yellow-crowned Euphonia 0.0279; Vireo olivaceus_Red-eyed Vireo 0.0075 |
