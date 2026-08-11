import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController, UITextViewDelegate {
  private let markerPrefix = "YODA_MOBILE_SHARE|"
  private var didStartLoading = false
  private var imageData: Data?
  private var sharedText: String?

  private let scrollView = UIScrollView()
  private let contentStack = UIStackView()
  private let previewImageView = UIImageView()
  private let sharedTextLabel = UILabel()
  private let promptTextView = UITextView()
  private let promptPlaceholder = UILabel()
  private let statusLabel = UILabel()
  private let activityIndicator = UIActivityIndicatorView(style: .medium)
  private let submitButton = UIButton(type: .system)

  override func viewDidLoad() {
    super.viewDidLoad()
    configureView()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !didStartLoading else { return }
    didStartLoading = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
      self?.loadInput()
    }
  }

  func textViewDidChange(_ textView: UITextView) {
    promptPlaceholder.isHidden = !textView.text.isEmpty
    updateSubmitState()
  }

  private func configureView() {
    view.backgroundColor = .systemBackground

    scrollView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scrollView)
    NSLayoutConstraint.activate([
      scrollView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
      scrollView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
      scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      scrollView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
    ])

    contentStack.axis = .vertical
    contentStack.spacing = 14
    contentStack.isLayoutMarginsRelativeArrangement = true
    contentStack.layoutMargins = UIEdgeInsets(top: 18, left: 20, bottom: 20, right: 20)
    contentStack.translatesAutoresizingMaskIntoConstraints = false
    scrollView.addSubview(contentStack)
    NSLayoutConstraint.activate([
      contentStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
      contentStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
      contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
      contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
      contentStack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor),
    ])

    let header = UIStackView()
    header.axis = .horizontal
    header.alignment = .center
    header.spacing = 12

    let titleStack = UIStackView()
    titleStack.axis = .vertical
    titleStack.spacing = 2

    let titleLabel = UILabel()
    titleLabel.font = .preferredFont(forTextStyle: .headline)
    titleLabel.text = "Yoda Mobile"
    titleStack.addArrangedSubview(titleLabel)

    let subtitleLabel = UILabel()
    subtitleLabel.font = .preferredFont(forTextStyle: .subheadline)
    subtitleLabel.textColor = .secondaryLabel
    subtitleLabel.text = "开始一项新工作"
    titleStack.addArrangedSubview(subtitleLabel)

    let cancelButton = UIButton(type: .system)
    cancelButton.setTitle("取消", for: .normal)
    cancelButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)

    header.addArrangedSubview(titleStack)
    header.addArrangedSubview(UIView())
    header.addArrangedSubview(cancelButton)
    contentStack.addArrangedSubview(header)

    previewImageView.contentMode = .scaleAspectFit
    previewImageView.backgroundColor = .secondarySystemBackground
    previewImageView.layer.cornerRadius = 14
    previewImageView.clipsToBounds = true
    previewImageView.isHidden = true
    previewImageView.heightAnchor.constraint(equalToConstant: 220).isActive = true
    contentStack.addArrangedSubview(previewImageView)

    sharedTextLabel.font = .preferredFont(forTextStyle: .body)
    sharedTextLabel.textColor = .label
    sharedTextLabel.numberOfLines = 8
    sharedTextLabel.backgroundColor = .secondarySystemBackground
    sharedTextLabel.layer.cornerRadius = 14
    sharedTextLabel.clipsToBounds = true
    sharedTextLabel.isHidden = true
    contentStack.addArrangedSubview(sharedTextLabel)

    let promptLabel = UILabel()
    promptLabel.font = .preferredFont(forTextStyle: .subheadline)
    promptLabel.textColor = .secondaryLabel
    promptLabel.text = "补充说明（可选）"
    contentStack.addArrangedSubview(promptLabel)

    promptTextView.delegate = self
    promptTextView.font = .preferredFont(forTextStyle: .body)
    promptTextView.backgroundColor = .secondarySystemBackground
    promptTextView.layer.cornerRadius = 14
    promptTextView.textContainerInset = UIEdgeInsets(top: 13, left: 12, bottom: 13, right: 12)
    promptTextView.heightAnchor.constraint(equalToConstant: 88).isActive = true
    contentStack.addArrangedSubview(promptTextView)

    promptPlaceholder.font = .preferredFont(forTextStyle: .body)
    promptPlaceholder.textColor = .tertiaryLabel
    promptPlaceholder.text = "例如：分析这张截图并告诉我下一步怎么做"
    promptPlaceholder.translatesAutoresizingMaskIntoConstraints = false
    promptTextView.addSubview(promptPlaceholder)
    NSLayoutConstraint.activate([
      promptPlaceholder.leadingAnchor.constraint(equalTo: promptTextView.leadingAnchor, constant: 16),
      promptPlaceholder.trailingAnchor.constraint(equalTo: promptTextView.trailingAnchor, constant: -16),
      promptPlaceholder.topAnchor.constraint(equalTo: promptTextView.topAnchor, constant: 13),
    ])

    let statusStack = UIStackView(arrangedSubviews: [activityIndicator, statusLabel])
    statusStack.axis = .horizontal
    statusStack.alignment = .center
    statusStack.spacing = 8
    statusLabel.font = .preferredFont(forTextStyle: .footnote)
    statusLabel.textColor = .secondaryLabel
    contentStack.addArrangedSubview(statusStack)

    var buttonConfiguration = UIButton.Configuration.filled()
    buttonConfiguration.title = "准备共享"
    buttonConfiguration.cornerStyle = .large
    buttonConfiguration.contentInsets = NSDirectionalEdgeInsets(top: 13, leading: 18, bottom: 13, trailing: 18)
    submitButton.configuration = buttonConfiguration
    submitButton.addTarget(self, action: #selector(submit), for: .touchUpInside)
    submitButton.isEnabled = false
    contentStack.addArrangedSubview(submitButton)
  }

  private func loadInput() {
    guard
      let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
      let provider = extensionItem.attachments?.first(where: {
        $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
          || $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
      })
    else {
      showError("当前内容暂不支持分享给 Yoda Mobile。")
      return
    }

    activityIndicator.startAnimating()
    if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
      provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] data, error in
        guard let self else { return }
        DispatchQueue.main.async {
          guard let data, let image = UIImage(data: data), let pngData = image.pngData() else {
            self.showError(error?.localizedDescription ?? "图片读取失败，请重试。")
            return
          }
          self.imageData = pngData
          self.previewImageView.image = image
          self.previewImageView.isHidden = false
          self.finishLoading()
        }
      }
    } else {
      provider.loadDataRepresentation(forTypeIdentifier: UTType.plainText.identifier) { [weak self] data, error in
        guard let self else { return }
        DispatchQueue.main.async {
          guard let data, let text = String(data: data, encoding: .utf8), !text.isEmpty else {
            self.showError(error?.localizedDescription ?? "文字读取失败，请重试。")
            return
          }
          self.sharedText = text
          self.sharedTextLabel.text = text
          self.sharedTextLabel.isHidden = false
          self.finishLoading()
        }
      }
    }
  }

  private func finishLoading() {
    activityIndicator.stopAnimating()
    statusLabel.text = "确认后会返回来源 App，内容会保留给 Yoda Mobile。"
    updateSubmitState()
  }

  private func updateSubmitState() {
    submitButton.isEnabled = imageData != nil || sharedText != nil
  }

  @objc private func submit() {
    guard imageData != nil || sharedText != nil else { return }

    let token = UUID().uuidString
    let kind = imageData == nil ? "text" : "image"
    let marker = "\(markerPrefix)\(token)|\(kind)"
    let prompt = promptTextView.text.trimmingCharacters(in: .whitespacesAndNewlines)

    if let imageData {
      let payload = prompt.isEmpty ? marker : "\(marker)\n\(prompt)"
      UIPasteboard.general.setItems(
        [[UTType.png.identifier: imageData, UTType.plainText.identifier: payload]],
        options: [.expirationDate: Date(timeIntervalSinceNow: 300)]
      )
    } else if let sharedText {
      let combined = [prompt, sharedText]
        .filter { !$0.isEmpty }
        .joined(separator: "\n\n")
      UIPasteboard.general.setItems(
        [[UTType.plainText.identifier: "\(marker)\n\(combined)"]],
        options: [.expirationDate: Date(timeIntervalSinceNow: 300)]
      )
    }

    submitButton.isEnabled = false
    statusLabel.text = "已准备好"
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
  }

  @objc private func cancel() {
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }

  private func showError(_ message: String) {
    activityIndicator.stopAnimating()
    statusLabel.text = message
    statusLabel.textColor = .systemRed
    submitButton.isEnabled = false
  }
}
