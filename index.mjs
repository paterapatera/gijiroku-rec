import { setLogLevel, Model, Recognizer } from 'vosk'
import { existsSync, promises, WriteStream } from 'fs'
import mic from 'mic'
import dayjs from 'dayjs'
import path from 'path'

if (process.argv.length < 3) {
  console.error('引数に保存先を指定してください')
  process.exit()
}

const DESTINATION_TO_SAVE = path.resolve(process.argv[2])
const MODEL_PATH = 'model'
const SAMPLE_RATE = 44100

if (!existsSync(MODEL_PATH)) {
  console.log(
    'https://alphacephei.com/vosk/models からダウンロードして解凍したデータを' +
      MODEL_PATH +
      'ディレクトリに入れてください'
  )
  process.exit()
}

/**
 * MP3ファイルを作るクラス
 */
class Mp3 {
  constructor(datetime) {
    this.fileStream = Mp3.createFileStream(Mp3.createFileName(datetime))
  }

  write(data) {
    this.fileStream.write(data)
  }

  end() {
    this.fileStream.end()
  }

  // 新しい音声ファイル作成する。HTMLタグの書き込みも行う
  rotate = (memo, datetime) => {
    const mp3FileName = Mp3.createFileName(datetime)
    memo.writeAudio(mp3FileName)
    this.end()
    this.fileStream = Mp3.createFileStream(mp3FileName)
  }

  // 音声ファイル作成する
  static createFileStream = (mp3FileName) => WriteStream(path.resolve(DESTINATION_TO_SAVE, mp3FileName))

  // ファイル名を生成
  static createFileName = (datetime) => datetime.format('HH-mm-ss') + '.mp3'
}

/**
 * memo.htmlを作るクラス
 */
class Memo {
  constructor() {
    this.fileStream = Memo.createFileStream()
    this.fileStream.write(Memo.createHtmlScript())
  }

  // HTMLにメッセージを書き込む
  writeMessage(result, datetime) {
    this.fileStream.write(Memo.createMessage(result, datetime))
  }

  // HTMLに音声ファイルを書き込む
  writeAudio(filename) {
    this.fileStream.write(Memo.createAudioTag(filename))
  }

  end() {
    this.fileStream.end()
  }

  // メモファイル作成する
  static createFileStream() {
    return WriteStream(path.resolve(DESTINATION_TO_SAVE, 'memo.html'))
  }

  static getText(result) {
    return result.text.replace(/\s/g, '')
  }

  // メッセージが空なのか判定。空ならfalse
  static isExist(result) {
    return this.getText(result).length !== 0
  }

  // HTMLでメッセージを表示するタグを生成
  static createMessage(result, datetime) {
    const mes = this.getText(result)
    const time = datetime.format('HH:mm:ss')
    return `<p>(${time}) ${mes}。</p>\n`
  }

  // HTMLで音声ファイルを表示するタグを生成
  static createAudioTag(fileName) {
    return `<audio controls src="${fileName}"></audio>\n`
  }

  static createHtmlScript() {
    return `<script>
      const audios = document.getElementsByTagName('audio')
      setTimeout(() => {
        console.log(audios)
        Array.from(audios).forEach((audio) => {
          audio.playbackRate = 2
        })
      }, 1000)
    </script>`
  }
}

// 初期処理
await promises.mkdir(DESTINATION_TO_SAVE, { recursive: true })

const memo = new Memo()
const mp3 = new Mp3(dayjs())
mp3.rotate(memo, dayjs())

setLogLevel(-1)
const model = new Model(MODEL_PATH)
const rec = new Recognizer({ model: model, sampleRate: SAMPLE_RATE })

// 文字起こしプロセス
const micInstance = mic({
  rate: String(SAMPLE_RATE),
  channels: '1',
  debug: false,
  device: 'default',
})

const micInputStream = micInstance.getAudioStream()

micInputStream.on('data', (data) => {
  if (rec.acceptWaveform(data)) {
    const result = rec.result()
    if (Memo.isExist(result)) {
      memo.writeMessage(result, dayjs())
      mp3.rotate(memo, dayjs())
    }
  }
})

micInputStream.on('audioProcessExitComplete', function () {
  memo.writeMessage(rec.finalResult(), dayjs())
  memo.end()
  rec.free()
  model.free()
})

// 録音プロセス
const recInstance = mic({
  rate: String(SAMPLE_RATE),
  channels: '1',
  debug: false,
  device: 'default',
  fileType: 'mp3',
})

const recInputStream = recInstance.getAudioStream()

recInputStream.on('data', (data) => {
  mp3.write(data)
})

recInputStream.on('audioProcessExitComplete', function () {
  mp3.end()
})

// プロセスイベント
process.on('SIGINT', function () {
  micInstance.stop()
  recInstance.stop()
})

// 開始
micInstance.start()
recInstance.start()
