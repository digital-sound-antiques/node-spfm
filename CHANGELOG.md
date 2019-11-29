# v0.6.2
- 演奏状況の表示でメモリリークが発生するため、暫定的に演奏状況を無効にしました。

# v0.6.1
- 曲移動時に SN76489 のトーン／ノイズ周波数が初期化されていなかった問題を修正しました。

# v0.6.0
- SN76489 のクロック自動補正に対応しました。
  - ノイズ周波数は補正されない場合があります。
- SN76489 を AY8910 または YM2203/YM2608 の SSG に変換して演奏できるようになりました。
  - ノイズチャンネルは演奏されません。
  - 音量変化は完全には再現できません。
- モジュールの割り当てロジックを改良しました。なるべく多くのパートが演奏できるよう、モジュールの割り当てが自動で決定されます。
- `spfm play` コマンドに、優先して演奏したいチップを指定する `--prioritize` オプションを追加しました。

# v0.5.0
- 曲移動時のクリックノイズを低減
  - 曲の移動時にデバイスを切断／再接続／リセットしないようにしました。
  - 曲の移動時にデバイスをリセットする場合は、`spfm play` コマンドに `--force-reset` オプションを付けてください。
- OPL系モジュール (YM3526/YM3812/Y8950/YM2413) のクロック自動補正に対応しました。
  - VGMで指定されたクロックが、音源側の実クロックと異なる場合、音程（周波数）を自動補正して演奏します。
  - エンベロープ速度は調整されません。
 
# v0.4.4
- OPN系モジュール (YM2203/YM2608/YM2612) のクロック自動補正に対応しました。
  - VGMで指定されたクロックが、音源側の実クロックと異なる場合、音程（周波数）を自動補正して演奏します。
  - エンベロープ速度は調整されません。
- YM2608 モジュールでの YM2612 の互換演奏に対応しました。PCMは未対応です。
- VGM に AY-3-8910 のステレオマスクコマンド(0x31)が含まれていた場合、無視して演奏を続けるようになりました。
- VGM に RF5C68 のコマンドが含まれていた場合、無視して演奏を続けるようになりました。
- モジュール割り当ての優先度を改善しました。以下の順で優先的に使用します。
  - VGMの指定と一致するチップが載ったモジュールで、クロックが一致するもの
  - VGMの指定と一致するチップが載ったモジュールで、音程ズレのソフトウェア補正が可能なもの
  - VGMの指定と互換性のあるチップが載ったモジュールで、クロックが一致するもの
  - VGMの指定と互換性のあるチップが載ったモジュールで、音程ズレのソフトウェア補正が可能なもの
- クロックのずれが±2%までであれば、一致と解釈してモジュールを使用します。

# v0.4.2
- Dual Chip (複数チップ同時利用) VGM をサポートしました。

# v0.3.2
- YM2608 の ADPCM RAM 1bits モード( 4 バイト単位のアクセス)をサポートしました。

# v0.3.0
- AY-3-8910 のクロック自動補正に対応しました。
  - VGMで指定されたクロックが、音源側の実クロックと異なる場合でも、音程・ノイズ・エンベロープ周期を自動補正して演奏します。

# v0.2.0
- YM2608 の ADPCM RAM 8bits モード(32バイト単位のアクセス)をサポートしました。
- SPFMのコンフィグ情強は、SPFM デバイスのシリアル番号と紐付けて保存されるようになりました。これにより、
  - デバイスを指し直してパスが変わっても問題ありません。
  - Mac/Linux/Windows 全環境で同じ設定 JSON ファイルを使用できます。